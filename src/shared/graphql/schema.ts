import { gql } from "graphql-tag"

export const typeDefs = gql`
  # Recommended by: https://the-guild.dev/graphql/scalars/docs/scalars/big-int
  directive @auth on FIELD_DEFINITION

  scalar DateTime
  scalar JSON
  scalar PositiveInt
  scalar BigInt

  type Notification {
    id: PositiveInt!
    userId: PositiveInt!
    data: JSON!
    createdAt: DateTime!
    read: Boolean!
  }

  type NotificationsResponse {
    notifications: [Notification]!
    startIndex: Int!
    total: Int!
  }

  type Success {
    success: Boolean!
  }

  # Authentication types
  type SiweMessageResult {
    message: String!
    nonce: String!
  }

  type AuthResult {
    success: Boolean!
    token: String
    web3Wallet: String
    error: String
  }

  type ValidateTokenResult {
    valid: Boolean!
    web3Wallet: String
  }

  type EmailVerificationResult {
    success: Boolean!
    blob: String
    error: String
  }

  # OAuth types
  enum OAuthProvider {
    GOOGLE
    FACEBOOK
    GITHUB
    X
    TIKTOK
    LINKEDIN
  }

  type OAuthLoginUrlResult {
    success: Boolean!
    url: String
    provider: String
    error: String
  }

  input PageParam {
    startIndex: Int!
    perPage: Int!
  }

  # Age range enum for user profiles
  enum AgeRange {
    AGE_18_24
    AGE_25_34
    AGE_35_44
    AGE_45_54
    AGE_55_PLUS
  }

  # Post type enum
  enum PostType {
    POST
    RESPONSE
  }

  # Post status enum
  enum PostStatus {
    AWAITING_PROCESSING
    PROCESSED
    DELETED
  }

  # Sort options for lists
  enum SortBy {
    NEWEST
    OLDEST
    MOST_SAVED
    LEAST_SAVED
    MOST_RESPONSES
    LEAST_RESPONSES
  }

  # User profile type
  type UserProfile {
    id: PositiveInt!
    userId: PositiveInt!
    username: String!
    ageRange: AgeRange
    occupation: String
    city: String!
    createdAt: DateTime!
  }

  # Post summary for lists (excludes audioUrl)
  type PostSummary {
    id: PositiveInt!
    userId: PositiveInt!
    author: UserProfile!
    type: PostType!
    status: PostStatus!
    parentId: PositiveInt
    duration: PositiveInt!
    tags: [String!]!
    waveformUrl: String
    responseCount: PositiveInt!
    bookmarkCount: PositiveInt!
    isBookmarked: Boolean!
    createdAt: DateTime!
  }

  # Full post type with audio URL
  type Post {
    id: PositiveInt!
    userId: PositiveInt!
    author: UserProfile!
    type: PostType!
    status: PostStatus!
    parentId: PositiveInt
    audioUrl: String
    duration: PositiveInt!
    tags: [String!]!
    waveformUrl: String
    responseCount: PositiveInt!
    bookmarkCount: PositiveInt!
    isBookmarked: Boolean!
    city: String!
    createdAt: DateTime!
  }

  # Paginated posts response
  type PostsConnection {
    posts: [PostSummary!]!
    hasMore: Boolean!
    nextCursor: String
  }

  # Pulse statistics for tag analytics
  type PulseTagStat {
    tag: String!
    count: PositiveInt!
    percentage: Float!
  }

  type PulseStats {
    city: String!
    period: String!
    tags: [PulseTagStat!]!
  }

  # Legal content type
  type LegalContent {
    type: String!
    title: String!
    content: String!
    version: String!
    effectiveDate: DateTime!
  }

  # Upload URL result
  type UploadUrlResult {
    success: Boolean!
    uploadUrl: String
    publicUrl: String
    key: String
    error: String
  }

  # Profile update input
  input UpdateProfileInput {
    username: String
    ageRange: AgeRange
    occupation: String
    city: String
  }

  type Query {
    # Token validation (requires auth header, but validates it)
    validateToken: ValidateTokenResult!

    # User-specific queries (auth required)
    getMyNotifications(pageParam: PageParam!): NotificationsResponse! @auth
    getMyUnreadNotificationsCount: Int! @auth

    # Profile queries
    getMyProfile: UserProfile @auth
    getProfileByUsername(username: String!): UserProfile @auth

    # Posts queries (returns PostSummary)
    getPosts(city: String, tags: [String!], cursor: String, limit: PositiveInt): PostsConnection! @auth
    getMyPosts(type: PostType, sortBy: SortBy, cursor: String, limit: PositiveInt): PostsConnection! @auth
    getUserPosts(userId: PositiveInt!, type: PostType, sortBy: SortBy, cursor: String, limit: PositiveInt): PostsConnection! @auth
    getMyBookmarks(sortBy: SortBy, cursor: String, limit: PositiveInt): PostsConnection! @auth

    # Post detail (returns full Post with audioUrl)
    getPostById(id: PositiveInt!): Post @auth

    # Responses queries
    getResponses(postId: PositiveInt!, sortBy: SortBy, cursor: String, limit: PositiveInt): PostsConnection! @auth

    # Pulse stats
    getPulseStats(city: String!, period: String!): PulseStats! @auth

    # Legal content (no auth required)
    getPrivacyPolicy: LegalContent
    getTermsAndConditions: LegalContent
  }

  type Mutation {
    # Authentication mutations (no auth required)
    generateSiweMessage(address: String!, chainId: Int!, domain: String!): SiweMessageResult!
    authenticateWithSiwe(message: String!, signature: String!): AuthResult!
    sendEmailVerificationCode(email: String!): EmailVerificationResult!
    authenticateWithEmail(email: String!, code: String!, blob: String!): AuthResult!
    getOAuthLoginUrl(provider: OAuthProvider!, redirectUrl: String): OAuthLoginUrlResult!
    authenticateWithFirebase(idToken: String!): AuthResult!

    # User-specific mutations (auth required)
    markNotificationAsRead(id: PositiveInt!): Success! @auth
    markAllNotificationsAsRead: Success! @auth

    # Profile mutations
    createProfile(username: String!, ageRange: AgeRange, occupation: String): UserProfile! @auth
    updateProfile(input: UpdateProfileInput!): UserProfile! @auth

    # Audio upload
    getAudioUploadUrl(contentType: String!): UploadUrlResult! @auth

    # Post mutations
    createPost(audioKey: String!, duration: PositiveInt!, tags: [String!]): Post! @auth
    createResponse(parentId: PositiveInt!, audioKey: String!, duration: PositiveInt!, tags: [String!]): Post! @auth
    deletePost(id: PositiveInt!): Success! @auth

    # Bookmark mutations
    bookmarkPost(postId: PositiveInt!): Success! @auth
    removeBookmark(postId: PositiveInt!): Success! @auth
  }
`
