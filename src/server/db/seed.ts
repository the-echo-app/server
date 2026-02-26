import {
  AUTH_METHOD,
  POST_STATUS,
  POST_TYPE,
  SENTIMENT_TAGS,
} from "@shared/constants"
import { eq } from "drizzle-orm"
import { dbManager, schema } from "./connection"
import type { NewBookmark, NewPost, NewUser, NewUserProfile } from "./schema"

export async function seedDatabase(
  options: { clear?: boolean } = {},
): Promise<void> {
  const db = await dbManager.connect({
    maxConnections: 1,
    idleTimeout: 0,
    connectTimeout: 10,
  })

  const existingUsers = await db.select().from(schema.users).limit(1)

  if (existingUsers.length > 0) {
    if (options.clear) {
      console.log("Clearing existing data...")
      await db.delete(schema.bookmarks)
      await db.delete(schema.posts)
      await db.delete(schema.userAuth)
      await db.delete(schema.userProfiles)
      await db.delete(schema.users)
    } else {
      console.log("Database already seeded, skipping...")
      await dbManager.disconnect()
      return
    }
  }

  const CITY = "singapore"
  const NUM_USERS = 10
  const NUM_POSTS = 10
  const RESPONSES_PER_POST = 20
  const BOOKMARKS_PER_USER = 5

  const ageRanges = ["18-24", "25-34", "35-44", "45-54", "55+"] as const
  const occupations = [
    "Software Engineer",
    "Designer",
    "Teacher",
    "Doctor",
    "Entrepreneur",
    "Student",
    "Artist",
    "Consultant",
    "Manager",
    "Freelancer",
  ]
  const tagOptions = SENTIMENT_TAGS.slice(0, NUM_POSTS)

  console.log(`  Creating ${NUM_USERS} users with profiles...`)
  const userIds: number[] = []

  for (let i = 1; i <= NUM_USERS; i++) {
    const userData: NewUser = {
      settings: { theme: "dark" },
      disabled: false,
    }
    const [user] = await db.insert(schema.users).values(userData).returning()
    if (!user) throw new Error("Failed to create user")
    userIds.push(user.id)

    await db.insert(schema.userAuth).values({
      userId: user.id,
      authType: AUTH_METHOD.PHONE,
      authIdentifier: `+6591234${String(i).padStart(4, "0")}`,
    })

    const profileData: NewUserProfile = {
      userId: user.id,
      username: `user${i}`,
      phoneNumber: `+6591234${String(i).padStart(4, "0")}`,
      ageRange: ageRanges[i % ageRanges.length],
      occupation: occupations[i - 1],
      city: CITY,
    }
    await db.insert(schema.userProfiles).values(profileData)
  }

  console.log(`  Creating ${NUM_POSTS} posts...`)
  const postIds: number[] = []

  for (let i = 0; i < NUM_POSTS; i++) {
    const userId = userIds[i]!
    const postData: NewPost = {
      userId,
      type: POST_TYPE.POST,
      audioUrl: `https://example.com/audio/post${i + 1}.webm`,
      audioKey: `audio/posts/post${i + 1}.webm`,
      duration: 30 + i * 5,
      tags: [tagOptions[i]],
      city: CITY,
      status: POST_STATUS.PROCESSED,
      responseCount: RESPONSES_PER_POST,
      bookmarkCount: 0,
    }
    const [post] = await db.insert(schema.posts).values(postData).returning()
    if (!post) throw new Error("Failed to create post")
    postIds.push(post.id)
  }

  console.log(
    `  Creating ${RESPONSES_PER_POST} responses per post (${NUM_POSTS * RESPONSES_PER_POST} total)...`,
  )

  for (const postId of postIds) {
    for (let r = 0; r < RESPONSES_PER_POST; r++) {
      const responderId = userIds[(r + 1) % NUM_USERS]!
      const responseData: NewPost = {
        userId: responderId,
        type: POST_TYPE.RESPONSE,
        parentId: postId,
        audioUrl: `https://example.com/audio/response${postId}_${r + 1}.webm`,
        audioKey: `audio/responses/response${postId}_${r + 1}.webm`,
        duration: 15 + (r % 30),
        tags: [],
        city: CITY,
        status: POST_STATUS.PROCESSED,
        responseCount: 0,
        bookmarkCount: 0,
      }
      await db.insert(schema.posts).values(responseData)
    }
  }

  console.log(
    `  Creating ${BOOKMARKS_PER_USER} bookmarks per user (${NUM_USERS * BOOKMARKS_PER_USER} total)...`,
  )

  for (let userIdx = 0; userIdx < NUM_USERS; userIdx++) {
    const userId = userIds[userIdx]!
    const bookmarkedPostIds = new Set<number>()

    while (bookmarkedPostIds.size < BOOKMARKS_PER_USER) {
      const randomPostIdx = (userIdx + bookmarkedPostIds.size + 1) % NUM_POSTS
      bookmarkedPostIds.add(postIds[randomPostIdx]!)
    }

    for (const postId of bookmarkedPostIds) {
      const bookmarkData: NewBookmark = {
        userId,
        postId,
      }
      await db.insert(schema.bookmarks).values(bookmarkData)
    }
  }

  for (const postId of postIds) {
    const bookmarkCountResult = await db
      .select()
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.postId, postId))
    await db
      .update(schema.posts)
      .set({ bookmarkCount: bookmarkCountResult.length })
      .where(eq(schema.posts.id, postId))
  }

  await dbManager.disconnect()

  console.log("✅ Database seeded successfully")
  console.log(`   - ${NUM_USERS} users with profiles`)
  console.log(`   - ${NUM_POSTS} posts`)
  console.log(`   - ${NUM_POSTS * RESPONSES_PER_POST} responses`)
  console.log(`   - ${NUM_USERS * BOOKMARKS_PER_USER} bookmarks`)
}
