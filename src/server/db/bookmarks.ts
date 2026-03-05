import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { PostWithAuthor, SortBy } from "./posts"
import {
  type Bookmark,
  bookmarks,
  type NewBookmark,
  posts,
  userProfiles,
} from "./schema"
import { type DatabaseOrTransaction, withTransaction } from "./shared"

export type { Bookmark }

/**
 * Check if a user has bookmarked a post
 */
export async function isPostBookmarked(
  db: DatabaseOrTransaction,
  userId: number,
  postId: number,
): Promise<boolean> {
  return db.startSpan("db.bookmarks.isPostBookmarked", async () => {
    const result = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
      .limit(1)

    return result.length > 0
  })
}

/**
 * Get bookmarks for multiple posts at once
 */
export async function getBookmarksForPosts(
  db: DatabaseOrTransaction,
  userId: number,
  postIds: number[],
): Promise<Set<number>> {
  return db.startSpan("db.bookmarks.getBookmarksForPosts", async () => {
    if (postIds.length === 0) {
      return new Set()
    }

    const result = await db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(
        and(eq(bookmarks.userId, userId), inArray(bookmarks.postId, postIds)),
      )

    return new Set(result.map((r) => r.postId))
  })
}

/**
 * Add a bookmark
 */
export async function addBookmark(
  db: DatabaseOrTransaction,
  userId: number,
  postId: number,
): Promise<Bookmark> {
  return db.startSpan("db.bookmarks.addBookmark", async () => {
    return withTransaction(db, async (tx) => {
      // Check if already bookmarked
      const existing = await tx
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
        .limit(1)

      if (existing[0]) {
        throw new Error("Post already bookmarked")
      }

      // Verify post exists and is active
      const post = await tx
        .select()
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.active, true)))
        .limit(1)

      if (!post[0]) {
        throw new Error("Post not found")
      }

      // Create bookmark
      const newBookmark: NewBookmark = {
        userId,
        postId,
      }

      const result = await tx.insert(bookmarks).values(newBookmark).returning()

      // Increment post's bookmark count
      await tx
        .update(posts)
        .set({
          bookmarkCount: sql`${posts.bookmarkCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId))

      return result[0]!
    })
  })
}

/**
 * Remove a bookmark
 */
export async function removeBookmark(
  db: DatabaseOrTransaction,
  userId: number,
  postId: number,
): Promise<boolean> {
  return db.startSpan("db.bookmarks.removeBookmark", async () => {
    return withTransaction(db, async (tx) => {
      // Find and delete bookmark
      const deleted = await tx
        .delete(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
        .returning()

      if (deleted.length === 0) {
        return false
      }

      // Decrement post's bookmark count
      await tx
        .update(posts)
        .set({
          bookmarkCount: sql`GREATEST(${posts.bookmarkCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId))

      return true
    })
  })
}

export interface GetBookmarksOptions {
  userId: number
  tags?: string[]
  sortBy?: SortBy
  cursor?: string
  limit?: number
}

/**
 * Get user's bookmarks with pagination, supporting sort by post-level fields
 */
export async function getUserBookmarks(
  db: DatabaseOrTransaction,
  options: GetBookmarksOptions,
): Promise<{
  posts: PostWithAuthor[]
  hasMore: boolean
  nextCursor?: string
}> {
  return db.startSpan("db.bookmarks.getUserBookmarks", async () => {
    const { userId, tags, sortBy = "NEWEST", cursor, limit = 20 } = options

    const conditions = [eq(bookmarks.userId, userId), eq(posts.active, true)]

    if (tags && tags.length > 0) {
      conditions.push(
        sql`${posts.tags} ?| array[${sql.join(
          tags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`,
      )
    }

    if (cursor) {
      const [cursorValue, cursorId] = cursor.split(":")
      if (cursorValue && cursorId) {
        const cursorIdNum = parseInt(cursorId, 10)
        switch (sortBy) {
          case "NEWEST":
            conditions.push(
              sql`(${bookmarks.createdAt}, ${bookmarks.id}) < (${new Date(cursorValue)}, ${cursorIdNum})`,
            )
            break
          case "OLDEST":
            conditions.push(
              sql`(${bookmarks.createdAt}, ${bookmarks.id}) > (${new Date(cursorValue)}, ${cursorIdNum})`,
            )
            break
          case "MOST_RESPONSES":
            conditions.push(
              sql`(${posts.responseCount}, ${bookmarks.id}) < (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "LEAST_RESPONSES":
            conditions.push(
              sql`(${posts.responseCount}, ${bookmarks.id}) > (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "MOST_SAVED":
            conditions.push(
              sql`(${posts.bookmarkCount}, ${bookmarks.id}) < (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
          case "LEAST_SAVED":
            conditions.push(
              sql`(${posts.bookmarkCount}, ${bookmarks.id}) > (${parseInt(cursorValue, 10)}, ${cursorIdNum})`,
            )
            break
        }
      }
    }

    let orderBy: any[]
    switch (sortBy) {
      case "OLDEST":
        orderBy = [asc(bookmarks.createdAt), asc(bookmarks.id)]
        break
      case "MOST_RESPONSES":
        orderBy = [desc(posts.responseCount), desc(bookmarks.id)]
        break
      case "LEAST_RESPONSES":
        orderBy = [asc(posts.responseCount), asc(bookmarks.id)]
        break
      case "MOST_SAVED":
        orderBy = [desc(posts.bookmarkCount), desc(bookmarks.id)]
        break
      case "LEAST_SAVED":
        orderBy = [asc(posts.bookmarkCount), asc(bookmarks.id)]
        break
      case "NEWEST":
      default:
        orderBy = [desc(bookmarks.createdAt), desc(bookmarks.id)]
    }

    const results = await db
      .select({
        bookmark: bookmarks,
        post: posts,
        author: {
          id: userProfiles.id,
          userId: userProfiles.userId,
          username: userProfiles.username,
          city: userProfiles.city,
        },
      })
      .from(bookmarks)
      .innerJoin(posts, eq(bookmarks.postId, posts.id))
      .innerJoin(userProfiles, eq(posts.userId, userProfiles.userId))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit + 1)

    const hasMore = results.length > limit
    const data = results.slice(0, limit)

    const postsWithAuthors: PostWithAuthor[] = data.map((r) => ({
      ...r.post,
      author: r.author,
      isBookmarked: true,
    }))

    let nextCursor: string | undefined
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]!
      switch (sortBy) {
        case "NEWEST":
        case "OLDEST":
          nextCursor = `${last.bookmark.createdAt.toISOString()}:${last.bookmark.id}`
          break
        case "MOST_RESPONSES":
        case "LEAST_RESPONSES":
          nextCursor = `${last.post.responseCount}:${last.bookmark.id}`
          break
        case "MOST_SAVED":
        case "LEAST_SAVED":
          nextCursor = `${last.post.bookmarkCount}:${last.bookmark.id}`
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
