import { GraphQLError } from "graphql"
import { SiweMessage } from "siwe"
import { clientConfig } from "../../shared/config/client"
import { serverConfig } from "../../shared/config/server"
import { POST_STATUS, POST_TYPE } from "../../shared/constants"
import { GraphQLErrorCode } from "../../shared/graphql/errors"
import { AuthService } from "../auth"
import {
  createAuthorizationParams,
  isProviderConfigured,
  OAuthConfigError,
  type OAuthProvider,
} from "../auth/oauth"
import { encryptOAuthState } from "../auth/oauth-state"
import { addBookmark, getUserBookmarks, removeBookmark } from "../db/bookmarks"
import { getPrivacyPolicy, getTermsAndConditions } from "../db/legalContent"
import {
  getNotificationsForUser,
  getUnreadNotificationsCountForUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../db/notifications"
import {
  createPost,
  createResponse,
  deletePost,
  getPostById,
  getPosts,
  type SortBy,
} from "../db/posts"
import {
  createProfile,
  getProfileByUserId,
  getProfileByUsername,
  updateProfile,
} from "../db/profiles"
import { pulseStats } from "../db/schema"
import { getUserById } from "../db/users"
import {
  generateVerificationCodeAndBlob,
  validateEmailFormat,
} from "../lib/emailVerification"
import { LOG_CATEGORIES } from "../lib/logger"
import { Mailer } from "../lib/mailer"
import {
  generateAudioUploadUrl,
  getPublicUrl,
  isR2Configured,
  isValidAudioContentType,
} from "../lib/r2"
import { setSentryUser } from "../lib/sentry"
import type { ServerApp } from "../types"
import type { Resolvers } from "./types"

/**
 * GraphQL resolvers with standard error handling
 */
export function createResolvers(serverApp: ServerApp): Resolvers {
  const logger = serverApp.createLogger(LOG_CATEGORIES.GRAPHQL_RESOLVERS)

  /**
   * Helper to wrap resolver execution with Sentry span and user context
   */
  const withSpan = async <T>(
    spanName: string,
    context: any,
    callback: () => Promise<T>,
  ): Promise<T> => {
    return serverApp.startSpan(spanName, async (span) => {
      if (context.user) {
        setSentryUser({
          id: context.user.id,
          web3Wallet: context.user.web3Wallet,
        })
        span.setAttributes({
          "user.id": context.user.id,
          ...(context.user.web3Wallet && {
            "user.web3Wallet": context.user.web3Wallet,
          }),
        })
      }
      return callback()
    })
  }

  // Helper function to get authenticated user and validate they exist
  const getAuthenticatedUser = async (context: any) => {
    if (!context.user) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: GraphQLErrorCode.UNAUTHORIZED },
      })
    }

    const user = await getUserById(serverApp.db, context.user.id)
    if (!user) {
      throw new GraphQLError("User not found", {
        extensions: { code: GraphQLErrorCode.NOT_FOUND },
      })
    }

    return user
  }

  // Helper to map age range enum from DB to GraphQL
  const mapAgeRangeToGraphQL = (
    ageRange: string | null,
  ):
    | "AGE_18_24"
    | "AGE_25_34"
    | "AGE_35_44"
    | "AGE_45_54"
    | "AGE_55_PLUS"
    | null => {
    if (!ageRange) return null
    const mapping: Record<
      string,
      "AGE_18_24" | "AGE_25_34" | "AGE_35_44" | "AGE_45_54" | "AGE_55_PLUS"
    > = {
      "18-24": "AGE_18_24",
      "25-34": "AGE_25_34",
      "35-44": "AGE_35_44",
      "45-54": "AGE_45_54",
      "55+": "AGE_55_PLUS",
    }
    return mapping[ageRange] || null
  }

  // Helper to map age range from GraphQL to DB
  const mapAgeRangeFromGraphQL = (
    ageRange: string | null | undefined,
  ): string | undefined => {
    if (!ageRange) return undefined
    const mapping: Record<string, string> = {
      AGE_18_24: "18-24",
      AGE_25_34: "25-34",
      AGE_35_44: "35-44",
      AGE_45_54: "45-54",
      AGE_55_PLUS: "55+",
    }
    return mapping[ageRange]
  }

  // Helper to map post to PostSummary
  const mapPostToSummary = (post: any) => {
    const isDeleted = post.status === POST_STATUS.DELETED
    return {
      id: post.id,
      userId: post.userId,
      author: {
        id: post.author.id,
        userId: post.author.userId,
        username: post.author.username,
        ageRange: null, // Not included in summary
        occupation: null,
        city: post.author.city,
        createdAt: post.createdAt,
      },
      type: post.type,
      status: post.status,
      parentId: post.parentId || null,
      duration: post.duration,
      tags: post.tags || [],
      waveformUrl: isDeleted ? null : post.waveformUrl || null,
      responseCount: post.responseCount,
      bookmarkCount: post.bookmarkCount,
      isBookmarked: post.isBookmarked,
      createdAt: post.createdAt,
    }
  }

  // Helper to map post to full Post
  const mapPostToFull = (post: any) => {
    const isDeleted = post.status === POST_STATUS.DELETED
    return {
      ...mapPostToSummary(post),
      audioUrl: isDeleted ? null : post.audioUrl,
      city: post.city,
    }
  }

  // Helper to map profile for GraphQL
  const mapProfileToGraphQL = (profile: any) => ({
    id: profile.id,
    userId: profile.userId,
    username: profile.username,
    ageRange: mapAgeRangeToGraphQL(profile.ageRange),
    occupation: profile.occupation || null,
    city: profile.city,
    createdAt: profile.createdAt,
  })

  return {
    Query: {
      // Token validation (requires auth header, but validates it)
      validateToken: async (_, __, context) => {
        return withSpan("graphql.Query.validateToken", context, async () => {
          try {
            if (context.user) {
              return {
                valid: true,
                web3Wallet: context.user.web3Wallet || null,
              }
            } else {
              return {
                valid: false,
                web3Wallet: null,
              }
            }
          } catch (error) {
            const logger = serverApp.createLogger(LOG_CATEGORIES.AUTH)
            logger.error("Error validating token:", error)
            return {
              valid: false,
              web3Wallet: null,
            }
          }
        })
      },

      // User notifications (auth required)
      getMyNotifications: async (_, { pageParam }, context) => {
        return withSpan(
          "graphql.Query.getMyNotifications",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              // Fetch notifications
              const [notifications, total] = await getNotificationsForUser(
                serverApp.db,
                user.id,
                pageParam,
              )

              logger.debug(
                `Retrieved ${notifications.length} notifications for user ${user.id}`,
              )

              return {
                notifications,
                startIndex: pageParam.startIndex,
                total,
              }
            } catch (error) {
              logger.error("Failed to get notifications:", error)
              throw new GraphQLError("Failed to retrieve notifications", {
                extensions: {
                  code: GraphQLErrorCode.DATABASE_ERROR,
                  originalError:
                    error instanceof Error ? error.message : String(error),
                },
              })
            }
          },
        )
      },

      getMyUnreadNotificationsCount: async (_, __, context) => {
        return withSpan(
          "graphql.Query.getMyUnreadNotificationsCount",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              const count = await getUnreadNotificationsCountForUser(
                serverApp.db,
                user.id,
              )

              logger.debug(`User ${user.id} has ${count} unread notifications`)

              return count
            } catch (error) {
              logger.error("Failed to get unread notifications count:", error)
              // For count queries, return 0 on error rather than throwing
              return 0
            }
          },
        )
      },

      // Profile queries
      getMyProfile: async (_, __, context) => {
        return withSpan("graphql.Query.getMyProfile", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const profile = await getProfileByUserId(serverApp.db, user.id)
            return profile ? mapProfileToGraphQL(profile) : null
          } catch (error) {
            logger.error("Failed to get profile:", error)
            throw new GraphQLError("Failed to get profile", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getProfileByUsername: async (_, { username }, context) => {
        return withSpan(
          "graphql.Query.getProfileByUsername",
          context,
          async () => {
            try {
              await getAuthenticatedUser(context)
              const profile = await getProfileByUsername(serverApp.db, username)
              return profile ? mapProfileToGraphQL(profile) : null
            } catch (error) {
              if (error instanceof GraphQLError) throw error
              logger.error("Failed to get profile by username:", error)
              throw new GraphQLError("Failed to get profile", {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              })
            }
          },
        )
      },

      // Posts queries
      getPosts: async (_, { city, tags, cursor, limit }, context) => {
        return withSpan("graphql.Query.getPosts", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const result = await getPosts(serverApp.db, {
              city: city || undefined,
              tags: tags || undefined,
              type: POST_TYPE.POST,
              cursor: cursor || undefined,
              limit: limit || 20,
              viewerUserId: user.id,
            })

            return {
              posts: result.posts.map(mapPostToSummary),
              hasMore: result.hasMore,
              nextCursor: result.nextCursor || null,
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get posts:", error)
            throw new GraphQLError("Failed to get posts", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getMyPosts: async (_, { type, sortBy, cursor, limit }, context) => {
        return withSpan("graphql.Query.getMyPosts", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const result = await getPosts(serverApp.db, {
              userId: user.id,
              type: type ? (type as any) : undefined,
              sortBy: (sortBy as SortBy) || "NEWEST",
              cursor: cursor || undefined,
              limit: limit || 20,
              viewerUserId: user.id,
            })

            return {
              posts: result.posts.map(mapPostToSummary),
              hasMore: result.hasMore,
              nextCursor: result.nextCursor || null,
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get my posts:", error)
            throw new GraphQLError("Failed to get posts", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getUserPosts: async (
        _,
        { userId, type, sortBy, cursor, limit },
        context,
      ) => {
        return withSpan("graphql.Query.getUserPosts", context, async () => {
          try {
            const viewer = await getAuthenticatedUser(context)
            const result = await getPosts(serverApp.db, {
              userId,
              type: type ? (type as any) : undefined,
              sortBy: (sortBy as SortBy) || "NEWEST",
              cursor: cursor || undefined,
              limit: limit || 20,
              viewerUserId: viewer.id,
            })

            return {
              posts: result.posts.map(mapPostToSummary),
              hasMore: result.hasMore,
              nextCursor: result.nextCursor || null,
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get user posts:", error)
            throw new GraphQLError("Failed to get posts", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getMyBookmarks: async (_, { sortBy, cursor, limit }, context) => {
        return withSpan("graphql.Query.getMyBookmarks", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const bookmarksResult = await getUserBookmarks(serverApp.db, {
              userId: user.id,
              sortBy: (sortBy as "NEWEST" | "OLDEST") || "NEWEST",
              cursor: cursor || undefined,
              limit: limit || 20,
            })

            // Fetch the actual posts for each bookmark
            const postsWithAuthors = await Promise.all(
              bookmarksResult.bookmarks.map((b) =>
                getPostById(serverApp.db, b.postId, user.id),
              ),
            )

            const validPosts = postsWithAuthors.filter(
              (p): p is NonNullable<typeof p> => p !== undefined,
            )

            return {
              posts: validPosts.map(mapPostToSummary),
              hasMore: bookmarksResult.hasMore,
              nextCursor: bookmarksResult.nextCursor || null,
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get bookmarks:", error)
            throw new GraphQLError("Failed to get bookmarks", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getPostById: async (_, { id }, context) => {
        return withSpan("graphql.Query.getPostById", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const post = await getPostById(serverApp.db, id, user.id)

            if (!post) {
              return null
            }

            return mapPostToFull(post)
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get post:", error)
            throw new GraphQLError("Failed to get post", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getResponses: async (_, { postId, sortBy, cursor, limit }, context) => {
        return withSpan("graphql.Query.getResponses", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)
            const result = await getPosts(serverApp.db, {
              parentId: postId,
              type: POST_TYPE.RESPONSE,
              sortBy: (sortBy as SortBy) || "NEWEST",
              cursor: cursor || undefined,
              limit: limit || 20,
              viewerUserId: user.id,
            })

            return {
              posts: result.posts.map(mapPostToSummary),
              hasMore: result.hasMore,
              nextCursor: result.nextCursor || null,
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get responses:", error)
            throw new GraphQLError("Failed to get responses", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getPulseStats: async (_, { city, period }, context) => {
        return withSpan("graphql.Query.getPulseStats", context, async () => {
          try {
            await getAuthenticatedUser(context)

            // Query pulse stats from database
            const { and, eq } = await import("drizzle-orm")
            const stats = await serverApp.db
              .select()
              .from(pulseStats)
              .where(
                and(eq(pulseStats.city, city), eq(pulseStats.period, period)),
              )

            return {
              city,
              period,
              tags: stats.map((s) => ({
                tag: s.tag,
                count: s.count,
                percentage: s.percentage,
              })),
            }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to get pulse stats:", error)
            throw new GraphQLError("Failed to get pulse stats", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      // Legal content queries (no auth required)
      getPrivacyPolicy: async (_, __, context) => {
        return withSpan("graphql.Query.getPrivacyPolicy", context, async () => {
          try {
            const content = await getPrivacyPolicy(serverApp.db)
            return content || null
          } catch (error) {
            logger.error("Failed to get privacy policy:", error)
            throw new GraphQLError("Failed to get privacy policy", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      getTermsAndConditions: async (_, __, context) => {
        return withSpan(
          "graphql.Query.getTermsAndConditions",
          context,
          async () => {
            try {
              const content = await getTermsAndConditions(serverApp.db)
              return content || null
            } catch (error) {
              logger.error("Failed to get terms and conditions:", error)
              throw new GraphQLError("Failed to get terms and conditions", {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              })
            }
          },
        )
      },
    },

    Mutation: {
      // Authentication mutations (no auth required)
      generateSiweMessage: async (_, { address, chainId, domain }, context) => {
        return withSpan(
          "graphql.Mutation.generateSiweMessage",
          context,
          async () => {
            // Check if web3 is enabled
            if (!clientConfig.WEB3_ENABLED) {
              throw new GraphQLError("Web3 authentication is not enabled", {
                extensions: { code: GraphQLErrorCode.AUTHENTICATION_FAILED },
              })
            }

            try {
              const authLogger = serverApp.createLogger(LOG_CATEGORIES.AUTH)
              authLogger.debug(
                `Generating SIWE message for address: ${address}, domain: ${domain}`,
              )

              // Validate domain against allowed origins
              const matchingOrigin =
                serverConfig.WEB3_ALLOWED_SIWE_ORIGINS?.find((origin) => {
                  const url = new URL(origin)
                  return url.host === domain
                })

              if (!matchingOrigin) {
                throw new GraphQLError("Invalid SIWE domain", {
                  extensions: { code: GraphQLErrorCode.AUTHENTICATION_FAILED },
                })
              }

              const message = new SiweMessage({
                domain,
                address,
                statement: "Sign in to Echo",
                uri: matchingOrigin,
                version: "1",
                chainId,
                nonce: Math.random().toString(36).substring(2, 15),
              })

              const messageString = message.prepareMessage()

              return {
                message: messageString,
                nonce: message.nonce || "",
              }
            } catch (error) {
              // Re-throw GraphQL errors as-is
              if (error instanceof GraphQLError) {
                throw error
              }
              logger.error("Failed to generate SIWE message:", error)
              throw new GraphQLError("Failed to generate SIWE message", {
                extensions: {
                  code: GraphQLErrorCode.INTERNAL_ERROR,
                },
              })
            }
          },
        )
      },

      authenticateWithSiwe: async (_, { message, signature }, context) => {
        return withSpan(
          "graphql.Mutation.authenticateWithSiwe",
          context,
          async () => {
            try {
              const logger = serverApp.createLogger(LOG_CATEGORIES.AUTH)
              const authService = new AuthService(serverApp)

              logger.debug("Authenticating with SIWE message")

              const authResult = await authService.authenticateWithSiwe(
                message,
                signature,
              )

              return {
                success: true,
                token: authResult.token,
                web3Wallet: authResult.user.web3Wallet || null,
                error: null,
              }
            } catch (error) {
              logger.error("SIWE authentication failed:", error)

              // Return error in result rather than throwing for better UX
              return {
                success: false,
                token: null,
                web3Wallet: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Authentication failed",
              }
            }
          },
        )
      },

      sendEmailVerificationCode: async (
        _: any,
        { email }: { email: string },
        context: any,
      ) => {
        return withSpan(
          "graphql.Mutation.sendEmailVerificationCode",
          context,
          async () => {
            try {
              const authLogger = serverApp.createLogger(LOG_CATEGORIES.AUTH)

              if (!validateEmailFormat(email)) {
                return {
                  success: false,
                  blob: null,
                  error: "Invalid email format",
                }
              }

              authLogger.debug("Generating email verification code")

              const { code, blob } = await generateVerificationCodeAndBlob(
                authLogger,
                email,
              )

              const mailer = new Mailer(authLogger)
              await mailer.send({
                to: email,
                subject: "Your verification code",
                text: `Your verification code is: ${code}`,
                html: `<p>Your verification code is: <strong>${code}</strong></p>`,
              })

              authLogger.debug("Email verification code sent")

              return {
                success: true,
                blob,
                error: null,
              }
            } catch (error) {
              logger.error("Failed to send email verification code:", error)

              return {
                success: false,
                blob: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to send verification code",
              }
            }
          },
        )
      },

      authenticateWithEmail: async (
        _: any,
        { email, code, blob }: { email: string; code: string; blob: string },
        context: any,
      ) => {
        return withSpan(
          "graphql.Mutation.authenticateWithEmail",
          context,
          async () => {
            try {
              const authLogger = serverApp.createLogger(LOG_CATEGORIES.AUTH)
              const authService = new AuthService(serverApp)

              authLogger.debug("Authenticating with email verification code")

              const authResult = await authService.authenticateWithEmail(
                email,
                code,
                blob,
              )

              return {
                success: true,
                token: authResult.token,
                web3Wallet: authResult.user.web3Wallet || null,
                error: null,
              }
            } catch (error) {
              logger.error("Email authentication failed:", error)

              return {
                success: false,
                token: null,
                web3Wallet: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Authentication failed",
              }
            }
          },
        )
      },

      getOAuthLoginUrl: async (
        _: any,
        {
          provider,
          redirectUrl,
        }: { provider: OAuthProvider; redirectUrl?: string | null },
        context: any,
      ) => {
        return withSpan(
          "graphql.Mutation.getOAuthLoginUrl",
          context,
          async () => {
            try {
              const authLogger = serverApp.createLogger(LOG_CATEGORIES.AUTH)

              // Check if provider is configured
              if (!isProviderConfigured(provider)) {
                return {
                  success: false,
                  url: null,
                  provider: null,
                  error: `OAuth provider ${provider} is not configured`,
                }
              }

              // Validate redirectUrl is same-origin if provided
              if (redirectUrl) {
                try {
                  const redirectUrlObj = new URL(redirectUrl)
                  const apiUrlObj = new URL(serverConfig.API_URL)
                  if (redirectUrlObj.origin !== apiUrlObj.origin) {
                    return {
                      success: false,
                      url: null,
                      provider: null,
                      error: "Redirect URL must be same-origin",
                    }
                  }
                } catch {
                  return {
                    success: false,
                    url: null,
                    provider: null,
                    error: "Invalid redirect URL",
                  }
                }
              }

              authLogger.debug(`Generating OAuth login URL for ${provider}`)

              // Generate auth params with placeholder state to get codeVerifier
              const authParams = createAuthorizationParams(
                provider,
                "placeholder",
              )

              // Create encrypted state containing provider, codeVerifier, and redirectUrl
              const encryptedState = await encryptOAuthState(
                provider,
                authParams.codeVerifier,
                redirectUrl ?? undefined,
              )

              // Replace placeholder state in URL with encrypted state
              const url = new URL(authParams.url.toString())
              url.searchParams.set("state", encryptedState)

              return {
                success: true,
                url: url.toString(),
                provider,
                error: null,
              }
            } catch (error) {
              logger.error(
                `OAuth login URL generation failed for ${provider}:`,
                error,
              )

              if (error instanceof OAuthConfigError) {
                return {
                  success: false,
                  url: null,
                  provider: null,
                  error: error.message,
                }
              }

              return {
                success: false,
                url: null,
                provider: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to generate OAuth login URL",
              }
            }
          },
        )
      },

      markNotificationAsRead: async (_, { id }, context) => {
        return withSpan(
          "graphql.Mutation.markNotificationAsRead",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              const success = await markNotificationAsRead(
                serverApp.db,
                user.id,
                id,
              )

              if (!success) {
                throw new GraphQLError(
                  "Notification not found or not owned by user",
                  {
                    extensions: { code: GraphQLErrorCode.NOT_FOUND },
                  },
                )
              }

              logger.debug(
                `Marked notification ${id} as read for user ${user.id}`,
              )

              return { success: true }
            } catch (error) {
              if (error instanceof GraphQLError) {
                throw error
              }

              logger.error("Failed to mark notification as read:", error)
              throw new GraphQLError("Failed to mark notification as read", {
                extensions: {
                  code: GraphQLErrorCode.DATABASE_ERROR,
                  originalError:
                    error instanceof Error ? error.message : String(error),
                },
              })
            }
          },
        )
      },

      markAllNotificationsAsRead: async (_, __, context) => {
        return withSpan(
          "graphql.Mutation.markAllNotificationsAsRead",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              const updatedCount = await markAllNotificationsAsRead(
                serverApp.db,
                user.id,
              )

              logger.debug(
                `Marked ${updatedCount} notifications as read for user ${user.id}`,
              )

              return { success: true }
            } catch (error) {
              logger.error("Failed to mark all notifications as read:", error)
              throw new GraphQLError(
                "Failed to mark all notifications as read",
                {
                  extensions: {
                    code: GraphQLErrorCode.DATABASE_ERROR,
                    originalError:
                      error instanceof Error ? error.message : String(error),
                  },
                },
              )
            }
          },
        )
      },

      // Firebase authentication
      authenticateWithFirebase: async (_, { idToken }, context) => {
        return withSpan(
          "graphql.Mutation.authenticateWithFirebase",
          context,
          async () => {
            try {
              const authService = new AuthService(serverApp)

              logger.debug("Authenticating with Firebase")

              const authResult =
                await authService.authenticateWithFirebase(idToken)

              return {
                success: true,
                token: authResult.token,
                web3Wallet: authResult.user.web3Wallet || null,
                error: null,
              }
            } catch (error) {
              logger.error("Firebase authentication failed:", error)

              return {
                success: false,
                token: null,
                web3Wallet: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Authentication failed",
              }
            }
          },
        )
      },

      // Profile mutations
      createProfile: async (_, { username, ageRange, occupation }, context) => {
        return withSpan("graphql.Mutation.createProfile", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)

            // Get phone number from user auth (required for profile)
            const { getUserAuthsByUserId } = await import("../db/userAuth")
            const auths = await getUserAuthsByUserId(serverApp.db, user.id)
            const phoneAuth = auths.find((a) => a.authType === "PHONE")

            if (!phoneAuth) {
              throw new GraphQLError(
                "Phone verification required before creating profile",
                {
                  extensions: { code: GraphQLErrorCode.INVALID_INPUT },
                },
              )
            }

            const profile = await createProfile(serverApp.db, {
              userId: user.id,
              username,
              phoneNumber: phoneAuth.authIdentifier,
              ageRange: mapAgeRangeFromGraphQL(ageRange) as any,
              occupation: occupation || undefined,
            })

            return mapProfileToGraphQL(profile)
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to create profile:", error)
            throw new GraphQLError(
              error instanceof Error
                ? error.message
                : "Failed to create profile",
              {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              },
            )
          }
        })
      },

      updateProfile: async (_, { input }, context) => {
        return withSpan("graphql.Mutation.updateProfile", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)

            const profile = await updateProfile(serverApp.db, user.id, {
              username: input.username || undefined,
              ageRange: mapAgeRangeFromGraphQL(input.ageRange) as any,
              occupation: input.occupation || undefined,
              city: input.city || undefined,
            })

            return mapProfileToGraphQL(profile)
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to update profile:", error)
            throw new GraphQLError(
              error instanceof Error
                ? error.message
                : "Failed to update profile",
              {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              },
            )
          }
        })
      },

      // Audio upload
      getAudioUploadUrl: async (_, { contentType }, context) => {
        return withSpan(
          "graphql.Mutation.getAudioUploadUrl",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              if (!isR2Configured()) {
                return {
                  success: false,
                  uploadUrl: null,
                  publicUrl: null,
                  key: null,
                  error: "Storage is not configured",
                }
              }

              if (!isValidAudioContentType(contentType)) {
                return {
                  success: false,
                  uploadUrl: null,
                  publicUrl: null,
                  key: null,
                  error: `Invalid audio content type: ${contentType}`,
                }
              }

              const result = await generateAudioUploadUrl(
                logger,
                user.id,
                contentType,
              )

              return {
                success: true,
                uploadUrl: result.uploadUrl,
                publicUrl: result.publicUrl,
                key: result.key,
                error: null,
              }
            } catch (error) {
              logger.error("Failed to generate upload URL:", error)
              return {
                success: false,
                uploadUrl: null,
                publicUrl: null,
                key: null,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to generate upload URL",
              }
            }
          },
        )
      },

      // Post mutations
      createPost: async (_, { audioKey, duration, tags }, context) => {
        return withSpan("graphql.Mutation.createPost", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)

            // Get user profile for city
            const profile = await getProfileByUserId(serverApp.db, user.id)
            if (!profile) {
              throw new GraphQLError("Profile required to create posts", {
                extensions: { code: GraphQLErrorCode.INVALID_INPUT },
              })
            }

            const audioUrl = getPublicUrl(audioKey)

            const post = await createPost(serverApp.db, {
              userId: user.id,
              audioUrl,
              audioKey,
              duration,
              tags: tags || [],
              city: profile.city,
            })

            // Queue waveform generation job
            try {
              const { scheduleJob } = await import("../db/worker")
              await scheduleJob(serverApp, {
                tag: `waveform-${post.id}`,
                type: "generateWaveform",
                userId: user.id,
                data: { postId: post.id, audioKey },
              })
            } catch (e) {
              logger.warn("Failed to queue waveform job:", e)
            }

            // Fetch with author for return
            const postWithAuthor = await getPostById(
              serverApp.db,
              post.id,
              user.id,
            )

            return mapPostToFull(postWithAuthor!)
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to create post:", error)
            throw new GraphQLError("Failed to create post", {
              extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
            })
          }
        })
      },

      createResponse: async (
        _,
        { parentId, audioKey, duration, tags },
        context,
      ) => {
        return withSpan(
          "graphql.Mutation.createResponse",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              const audioUrl = getPublicUrl(audioKey)

              const response = await createResponse(serverApp.db, {
                userId: user.id,
                parentId,
                audioUrl,
                audioKey,
                duration,
                tags: tags || [],
              })

              // Queue waveform generation job
              try {
                const { scheduleJob } = await import("../db/worker")
                await scheduleJob(serverApp, {
                  tag: `waveform-${response.id}`,
                  type: "generateWaveform",
                  userId: user.id,
                  data: { postId: response.id, audioKey },
                })
              } catch (e) {
                logger.warn("Failed to queue waveform job:", e)
              }

              // Fetch with author for return
              const responseWithAuthor = await getPostById(
                serverApp.db,
                response.id,
                user.id,
              )

              return mapPostToFull(responseWithAuthor!)
            } catch (error) {
              if (error instanceof GraphQLError) throw error
              logger.error("Failed to create response:", error)
              throw new GraphQLError(
                error instanceof Error
                  ? error.message
                  : "Failed to create response",
                {
                  extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
                },
              )
            }
          },
        )
      },

      deletePost: async (_, { id }, context) => {
        return withSpan("graphql.Mutation.deletePost", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)

            const success = await deletePost(serverApp.db, id, user.id)

            if (!success) {
              throw new GraphQLError("Post not found", {
                extensions: { code: GraphQLErrorCode.NOT_FOUND },
              })
            }

            return { success: true }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to delete post:", error)
            throw new GraphQLError(
              error instanceof Error ? error.message : "Failed to delete post",
              {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              },
            )
          }
        })
      },

      // Bookmark mutations
      bookmarkPost: async (_, { postId }, context) => {
        return withSpan("graphql.Mutation.bookmarkPost", context, async () => {
          try {
            const user = await getAuthenticatedUser(context)

            await addBookmark(serverApp.db, user.id, postId)

            return { success: true }
          } catch (error) {
            if (error instanceof GraphQLError) throw error
            logger.error("Failed to bookmark post:", error)
            throw new GraphQLError(
              error instanceof Error
                ? error.message
                : "Failed to bookmark post",
              {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              },
            )
          }
        })
      },

      removeBookmark: async (_, { postId }, context) => {
        return withSpan(
          "graphql.Mutation.removeBookmark",
          context,
          async () => {
            try {
              const user = await getAuthenticatedUser(context)

              const removed = await removeBookmark(
                serverApp.db,
                user.id,
                postId,
              )

              if (!removed) {
                throw new GraphQLError("Bookmark not found", {
                  extensions: { code: GraphQLErrorCode.NOT_FOUND },
                })
              }

              return { success: true }
            } catch (error) {
              if (error instanceof GraphQLError) throw error
              logger.error("Failed to remove bookmark:", error)
              throw new GraphQLError("Failed to remove bookmark", {
                extensions: { code: GraphQLErrorCode.DATABASE_ERROR },
              })
            }
          },
        )
      },
    },
  }
}
