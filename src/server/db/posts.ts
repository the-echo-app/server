import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import {
  POST_TYPE,
  type PostStatus,
  type PostType,
} from "../../shared/constants"
import {
  bookmarks,
  type NewPost,
  notifications,
  type Post,
  posts,
  userProfiles,
} from "./schema"
import { type DatabaseOrTransaction, withTransaction } from "./shared"

export type { Post }

export type SortBy =
  | "NEWEST"
  | "OLDEST"
  | "MOST_SAVED"
  | "LEAST_SAVED"
  | "MOST_RESPONSES"
  | "LEAST_RESPONSES"

export interface PostWithAuthor extends Post {
  author: {
    id: number
    userId: number
    username: string
    city: string
  }
  isBookmarked: boolean
}

export interface GetPostsOptions {
  city?: string
  tags?: string[]
  type?: PostType
  userId?: number
  parentId?: number
  sortBy?: SortBy
  cursor?: string
  limit?: number
  viewerUserId?: number
}

/**
 * Get post by ID
 */
export async function getPostById(
  db: DatabaseOrTransaction,
  id: number,
  viewerUserId?: number,
): Promise<PostWithAuthor | undefined> {
  return db.startSpan("db.posts.getPostById", async () => {
    const result = await db
      .select({
        post: posts,
        author: {
          id: userProfiles.id,
          userId: userProfiles.userId,
          username: userProfiles.username,
          city: userProfiles.city,
        },
      })
      .from(posts)
      .innerJoin(userProfiles, eq(posts.userId, userProfiles.userId))
      .where(and(eq(posts.id, id), eq(posts.active, true)))
      .limit(1)

    if (!result[0]) {
      return undefined
    }

    let isBookmarked = false
    if (viewerUserId) {
      const bookmark = await db
        .select()
        .from(bookmarks)
        .where(
          and(eq(bookmarks.userId, viewerUserId), eq(bookmarks.postId, id)),
        )
        .limit(1)
      isBookmarked = bookmark.length > 0
    }

    return {
      ...result[0].post,
      author: result[0].author,
      isBookmarked,
    }
  })
}

/**
 * Get posts with filtering, sorting, and pagination
 */
export async function getPosts(
  db: DatabaseOrTransaction,
  options: GetPostsOptions = {},
): Promise<{ posts: PostWithAuthor[]; hasMore: boolean; nextCursor?: string }> {
  return db.startSpan("db.posts.getPosts", async () => {
    const {
      city,
      tags,
      type = POST_TYPE.POST,
      userId,
      parentId,
      sortBy = "NEWEST",
      cursor,
      limit = 20,
      viewerUserId,
    } = options

    const conditions = [eq(posts.active, true)]

    if (type) {
      conditions.push(eq(posts.type, type))
    }

    if (city) {
      conditions.push(eq(posts.city, city))
    }

    if (userId) {
      conditions.push(eq(posts.userId, userId))
    }

    if (parentId) {
      conditions.push(eq(posts.parentId, parentId))
    }

    if (tags && tags.length > 0) {
      conditions.push(sql`${posts.tags} ?| ${tags}`)
    }

    // Handle cursor-based pagination
    if (cursor) {
      const [cursorValue, cursorId] = cursor.split(":")
      if (cursorValue && cursorId) {
        const cursorIdNum = parseInt(cursorId, 10)
        switch (sortBy) {
          case "NEWEST":
            conditions.push(
              sql`(${posts.createdAt}, ${posts.id}) < (${new Date(cursorValue)}, ${cursorIdNum})`,
            )
            break
          case "OLDEST":
            conditions.push(
              sql`(${posts.createdAt}, ${posts.id}) > (${new Date(cursorValue)}, ${cursorIdNum})`,
            )
            break
          case "MOST_SAVED":
            conditions.push(
              sql`(${posts.bookmarkCount}, ${posts.id}) < (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "LEAST_SAVED":
            conditions.push(
              sql`(${posts.bookmarkCount}, ${posts.id}) > (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "MOST_RESPONSES":
            conditions.push(
              sql`(${posts.responseCount}, ${posts.id}) < (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "LEAST_RESPONSES":
            conditions.push(
              sql`(${posts.responseCount}, ${posts.id}) > (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
        }
      }
    }

    // Determine sort order
    let orderBy: any[]
    switch (sortBy) {
      case "OLDEST":
        orderBy = [asc(posts.createdAt), asc(posts.id)]
        break
      case "MOST_SAVED":
        orderBy = [desc(posts.bookmarkCount), desc(posts.id)]
        break
      case "LEAST_SAVED":
        orderBy = [asc(posts.bookmarkCount), asc(posts.id)]
        break
      case "MOST_RESPONSES":
        orderBy = [desc(posts.responseCount), desc(posts.id)]
        break
      case "LEAST_RESPONSES":
        orderBy = [asc(posts.responseCount), asc(posts.id)]
        break
      case "NEWEST":
      default:
        orderBy = [desc(posts.createdAt), desc(posts.id)]
    }

    const results = await db
      .select({
        post: posts,
        author: {
          id: userProfiles.id,
          userId: userProfiles.userId,
          username: userProfiles.username,
          city: userProfiles.city,
        },
      })
      .from(posts)
      .innerJoin(userProfiles, eq(posts.userId, userProfiles.userId))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit + 1)

    const hasMore = results.length > limit
    const postsData = results.slice(0, limit)

    // Check bookmarks for viewer
    let bookmarkedPostIds: Set<number> = new Set()
    if (viewerUserId && postsData.length > 0) {
      const postIds = postsData.map((r) => r.post.id)
      const userBookmarks = await db
        .select({ postId: bookmarks.postId })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, viewerUserId),
            inArray(bookmarks.postId, postIds),
          ),
        )
      bookmarkedPostIds = new Set(userBookmarks.map((b) => b.postId))
    }

    const postsWithAuthors: PostWithAuthor[] = postsData.map((r) => ({
      ...r.post,
      author: r.author,
      isBookmarked: bookmarkedPostIds.has(r.post.id),
    }))

    // Generate next cursor
    let nextCursor: string | undefined
    if (hasMore && postsData.length > 0) {
      const lastPost = postsData[postsData.length - 1]!.post
      switch (sortBy) {
        case "NEWEST":
        case "OLDEST":
          nextCursor = `${lastPost.createdAt.toISOString()}:${lastPost.id}`
          break
        case "MOST_SAVED":
        case "LEAST_SAVED":
          nextCursor = `${lastPost.bookmarkCount}:${lastPost.id}`
          break
        case "MOST_RESPONSES":
        case "LEAST_RESPONSES":
          nextCursor = `${lastPost.responseCount}:${lastPost.id}`
          break
      }
    }

    return {
      posts: postsWithAuthors,
      hasMore,
      nextCursor,
    }
  })
}

/**
 * Create a new post
 */
export async function createPost(
  db: DatabaseOrTransaction,
  data: {
    userId: number
    audioUrl: string
    audioKey: string
    duration: number
    tags?: string[]
    city?: string
  },
): Promise<Post> {
  return db.startSpan("db.posts.createPost", async () => {
    const newPost: NewPost = {
      userId: data.userId,
      type: POST_TYPE.POST,
      audioUrl: data.audioUrl,
      audioKey: data.audioKey,
      duration: data.duration,
      tags: data.tags || [],
      city: data.city || "singapore",
    }

    const result = await db.insert(posts).values(newPost).returning()

    return result[0]!
  })
}

/**
 * Create a response to a post
 */
export async function createResponse(
  db: DatabaseOrTransaction,
  data: {
    userId: number
    parentId: number
    audioUrl: string
    audioKey: string
    duration: number
    tags?: string[]
  },
): Promise<Post> {
  return db.startSpan("db.posts.createResponse", async () => {
    return withTransaction(db, async (tx) => {
      // Get parent post to verify it exists and get author info
      const parentPost = await tx
        .select()
        .from(posts)
        .where(and(eq(posts.id, data.parentId), eq(posts.active, true)))
        .limit(1)

      if (!parentPost[0]) {
        throw new Error("Parent post not found")
      }

      // Create the response
      const newResponse: NewPost = {
        userId: data.userId,
        type: POST_TYPE.RESPONSE,
        parentId: data.parentId,
        audioUrl: data.audioUrl,
        audioKey: data.audioKey,
        duration: data.duration,
        tags: data.tags || [],
        city: parentPost[0].city,
      }

      const result = await tx.insert(posts).values(newResponse).returning()
      const response = result[0]!

      // Increment parent's response count
      await tx
        .update(posts)
        .set({
          responseCount: sql`${posts.responseCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, data.parentId))

      // Create notification for parent post author (if not responding to own post)
      if (parentPost[0].userId !== data.userId) {
        await tx.insert(notifications).values({
          userId: parentPost[0].userId,
          data: {
            type: "RESPONSE",
            postId: data.parentId,
            responseId: response.id,
            responderId: data.userId,
          },
        })
      }

      return response
    })
  })
}

/**
 * Delete a post (soft delete by setting active to false)
 */
export async function deletePost(
  db: DatabaseOrTransaction,
  postId: number,
  userId: number,
): Promise<boolean> {
  return db.startSpan("db.posts.deletePost", async () => {
    return withTransaction(db, async (tx) => {
      // Verify ownership
      const post = await tx
        .select()
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.active, true)))
        .limit(1)

      if (!post[0]) {
        return false
      }

      if (post[0].userId !== userId) {
        throw new Error("Not authorized to delete this post")
      }

      // Soft delete the post
      await tx
        .update(posts)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(posts.id, postId))

      // If this is a response, decrement parent's response count
      if (post[0].parentId) {
        await tx
          .update(posts)
          .set({
            responseCount: sql`GREATEST(${posts.responseCount} - 1, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, post[0].parentId))
      }

      return true
    })
  })
}

/**
 * Update post waveform URL (called by background worker)
 */
export async function updatePostWaveformUrl(
  db: DatabaseOrTransaction,
  postId: number,
  waveformUrl: string,
): Promise<void> {
  return db.startSpan("db.posts.updatePostWaveformUrl", async () => {
    await db
      .update(posts)
      .set({ waveformUrl, updatedAt: new Date() })
      .where(eq(posts.id, postId))
  })
}

/**
 * Update post status (called by background worker after processing)
 */
export async function updatePostStatus(
  db: DatabaseOrTransaction,
  postId: number,
  status: PostStatus,
): Promise<void> {
  return db.startSpan("db.posts.updatePostStatus", async () => {
    await db
      .update(posts)
      .set({ status, updatedAt: new Date() })
      .where(eq(posts.id, postId))
  })
}
