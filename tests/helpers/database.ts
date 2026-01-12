/**
 * Database test helpers for Echo
 *
 * Utilities for managing test database lifecycle,
 * creating test data, and cleaning up between tests.
 */

import { dbManager, schema } from "@server/db/connection"
import type {
  NewNotification,
  NewPost,
  NewUser,
  NewUserProfile,
  NewWorkerJob,
  Post,
  User,
  UserProfile,
} from "@server/db/schema"
import { serverConfig } from "@shared/config/server"
import { AUTH_METHOD, POST_STATUS, POST_TYPE } from "@shared/constants"
import { testLogger } from "@tests/helpers/logger"
import { sql } from "drizzle-orm"

/**
 * Initialize the shared test database connection
 * Uses the centralized connection manager to prevent pool exhaustion
 */
export async function initTestDb() {
  testLogger.info("🔌 Initializing shared test database connection...")

  if (!serverConfig.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL configuration is required for test database connection",
    )
  }

  // Use the centralized connection manager with test-specific settings
  const db = await dbManager.connect({
    maxConnections: 1, // Very low limit for tests to prevent pool exhaustion
    idleTimeout: 0, // Never timeout in tests
    connectTimeout: 10,
    databaseUrl: serverConfig.DATABASE_URL,
  })

  testLogger.info("✅ Shared test database connection established")
  return db
}

/**
 * Get the shared test database connection
 */
function getTestDb() {
  if (!dbManager.isConnectionActive()) {
    throw new Error("Test database not initialized. Call initTestDb() first.")
  }
  return dbManager.getDb()
}

/**
 * Close test database connection
 */
export async function closeTestDb() {
  await dbManager.disconnect()
}

/**
 * Clean test database
 * Removes all data but keeps schema by truncating tables in correct order
 */
export async function cleanTestDatabase(): Promise<void> {
  testLogger.info("🧹 Cleaning test database...")

  try {
    const db = getTestDb()

    // Truncate tables in reverse dependency order to respect foreign keys
    // Start with tables that reference others, then the tables they reference

    // First: Tables that reference other tables (most dependent first)
    await db.execute(sql`TRUNCATE TABLE bookmarks RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE posts RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE user_profiles RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE notifications RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE worker_jobs RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE user_auth RESTART IDENTITY CASCADE`)

    // Then: Tables that are referenced by others
    await db.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)

    // Finally: Independent tables
    await db.execute(sql`TRUNCATE TABLE settings RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE pulse_stats RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE legal_content RESTART IDENTITY CASCADE`)

    testLogger.info("✅ Test database cleaned")
  } catch (error) {
    testLogger.error("❌ Test database cleaning failed:", error)
    throw error
  }
}

/**
 * Reset test database sequences
 * Ensures auto-increment IDs start from 1 for consistent tests
 */
export async function resetTestDatabaseSequences(): Promise<void> {
  testLogger.info("🔄 Resetting test database sequences...")

  try {
    const db = getTestDb()

    // Reset all sequence counters to start from 1
    await db.execute(sql`ALTER SEQUENCE settings_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE users_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE user_auth_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE notifications_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE worker_jobs_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE user_profiles_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE posts_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE bookmarks_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE pulse_stats_id_seq RESTART WITH 1`)
    await db.execute(sql`ALTER SEQUENCE legal_content_id_seq RESTART WITH 1`)

    testLogger.info("✅ Test database sequences reset")
  } catch (error) {
    testLogger.error("❌ Test database sequence reset failed:", error)
    throw error
  }
}

/**
 * Setup test database
 * Ensures database is clean and ready for tests
 * Note: Global setup handles connection initialization
 */
export async function setupTestDatabase(): Promise<void> {
  testLogger.info("📦 Setting up test database...")

  try {
    // Ensure connection is active (singleton will reuse existing connection if available)
    if (!dbManager.isConnectionActive()) {
      testLogger.info("Database not connected, initializing...")
      await initTestDb()
    } else {
      testLogger.info("✅ Using existing database connection")
    }

    // Clean all data between tests
    await cleanTestDatabase()

    // Reset sequences for consistent test IDs
    await resetTestDatabaseSequences()

    testLogger.info("✅ Test database setup complete")
  } catch (error) {
    testLogger.error("❌ Test database setup failed:", error)
    throw error
  }
}

/**
 * Seed test database with initial data
 */
export async function seedTestDatabase(): Promise<void> {
  testLogger.info("🌱 Seeding test database...")

  try {
    // Create some basic test users with web3 wallets
    await createTestUser({
      web3Wallet: "0x742d35Cc6634C0532925a3b8D39A6Fa678e88CfD",
    })
    await createTestUser({
      web3Wallet: "0x8ba1f109551bD432803012645Hac136c30C8A4E4",
    })

    testLogger.info("✅ Test database seeded")
  } catch (error) {
    testLogger.error("❌ Test database seeding failed:", error)
    throw error
  }
}

/**
 * Create test user (optionally with web3 wallet auth)
 */
export async function createTestUser(
  userData: { web3Wallet?: string; settings?: any; disabled?: boolean } = {},
): Promise<User> {
  const { web3Wallet, ...userFields } = userData
  const defaultUser: NewUser = {
    settings: { theme: "dark" },
    disabled: false,
    ...userFields,
  }

  const db = getTestDb()
  const [user] = await db.insert(schema.users).values(defaultUser).returning()

  if (!user) {
    throw new Error("Failed to create test user")
  }

  // If web3Wallet provided, create a userAuth entry
  if (web3Wallet) {
    await db.insert(schema.userAuth).values({
      userId: user.id,
      authType: AUTH_METHOD.WEB3_WALLET,
      authIdentifier: web3Wallet.toLowerCase(),
    })
    testLogger.info("📝 Test user created with web3 wallet:", {
      id: user.id,
      web3Wallet,
    })
  } else {
    testLogger.info("📝 Test user created:", { id: user.id })
  }

  return user
}

/**
 * Set user disabled status
 */
export async function setTestUserDisabled(
  userId: number,
  disabled: boolean,
): Promise<void> {
  const db = getTestDb()
  await db
    .update(schema.users)
    .set({ disabled, updatedAt: new Date() })
    .where(sql`id = ${userId}`)

  testLogger.info("📝 Test user disabled status updated:", { userId, disabled })
}

/**
 * Create test notification
 */
export async function createTestNotification(
  notificationData: { userId: number; data: any; read?: boolean } = {
    userId: 1,
    data: { message: "Test notification" },
  },
): Promise<any> {
  const defaultNotification: NewNotification = {
    read: false,
    ...notificationData,
  }

  const db = getTestDb()
  const [notification] = await db
    .insert(schema.notifications)
    .values(defaultNotification)
    .returning()

  if (!notification) {
    throw new Error("Failed to create test notification")
  }

  testLogger.info("📝 Test notification created:", {
    id: notification.id,
    userId: notification.userId,
  })
  return notification
}

/**
 * Create test worker job
 */
export async function createTestWorkerJob(
  jobData: {
    tag?: string
    type: string
    userId: number
    data: any
    due?: Date
  } = {
    type: "testJob",
    userId: 1,
    data: { action: "test" },
  },
): Promise<any> {
  const tag = jobData.tag || `test:${Date.now()}-${Math.random()}`
  const defaultJob: NewWorkerJob = {
    tag,
    due: new Date(),
    removeAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...jobData,
  }

  const db = getTestDb()
  const [job] = await db
    .insert(schema.workerJobs)
    .values(defaultJob)
    .returning()

  if (!job) {
    throw new Error("Failed to create test worker job")
  }

  testLogger.info("📝 Test worker job created:", {
    id: job.id,
    type: job.type,
    userId: job.userId,
  })
  return job
}

/**
 * Get test database statistics
 * Useful for verifying database state during tests
 */
export async function getTestDatabaseStats(): Promise<{
  users: number
  notifications: number
  workerJobs: number
  settings: number
}> {
  const db = getTestDb()

  const [userCount] = await db.execute(sql`SELECT COUNT(*) as count FROM users`)
  const [notificationCount] = await db.execute(
    sql`SELECT COUNT(*) as count FROM notifications`,
  )
  const [jobCount] = await db.execute(
    sql`SELECT COUNT(*) as count FROM worker_jobs`,
  )
  const [settingCount] = await db.execute(
    sql`SELECT COUNT(*) as count FROM settings`,
  )

  return {
    users: userCount ? Number(userCount.count) : 0,
    notifications: notificationCount ? Number(notificationCount.count) : 0,
    workerJobs: jobCount ? Number(jobCount.count) : 0,
    settings: settingCount ? Number(settingCount.count) : 0,
  }
}

/**
 * Verify test database is empty
 * Useful for test cleanup verification
 */
export async function verifyTestDatabaseIsEmpty(): Promise<boolean> {
  const stats = await getTestDatabaseStats()
  return (
    stats.users === 0 &&
    stats.notifications === 0 &&
    stats.workerJobs === 0 &&
    stats.settings === 0
  )
}

/**
 * Create test user auth entry
 */
export async function createTestUserAuth(authData: {
  userId: number
  authType: "WEB3_WALLET" | "EMAIL" | "PHONE"
  authIdentifier: string
}): Promise<any> {
  const db = getTestDb()

  const [auth] = await db.insert(schema.userAuth).values(authData).returning()

  if (!auth) {
    throw new Error("Failed to create test user auth")
  }

  testLogger.info("📝 Test user auth created:", {
    id: auth.id,
    userId: auth.userId,
    authType: auth.authType,
  })

  return auth
}

/**
 * Create test user profile
 */
export async function createTestUserProfile(profileData: {
  userId: number
  username: string
  phoneNumber?: string
  ageRange?: "18-24" | "25-34" | "35-44" | "45-54" | "55+"
  occupation?: string
  city?: string
}): Promise<UserProfile> {
  const db = getTestDb()

  const { phoneNumber, ...rest } = profileData

  const defaultProfile: NewUserProfile = {
    city: "singapore",
    phoneNumber: phoneNumber || `+1${Date.now()}`,
    ...rest,
  }

  const [profile] = await db
    .insert(schema.userProfiles)
    .values(defaultProfile)
    .returning()

  if (!profile) {
    throw new Error("Failed to create test user profile")
  }

  testLogger.info("📝 Test user profile created:", {
    id: profile.id,
    userId: profile.userId,
    username: profile.username,
  })

  return profile
}

/**
 * Create test post
 */
export async function createTestPost(postData: {
  userId: number
  audioUrl?: string
  audioKey?: string
  duration?: number
  tags?: string[]
  city?: string
  type?: "POST" | "RESPONSE"
  parentId?: number
  status?: "AWAITING_PROCESSING" | "PROCESSED" | "DELETED"
}): Promise<Post> {
  const db = getTestDb()

  const defaultPost: NewPost = {
    type: POST_TYPE.POST,
    audioUrl: "https://example.com/audio/test.webm",
    audioKey: "audio/test/test.webm",
    duration: 30,
    tags: [],
    city: "singapore",
    status: POST_STATUS.AWAITING_PROCESSING,
    ...postData,
  }

  const [post] = await db.insert(schema.posts).values(defaultPost).returning()

  if (!post) {
    throw new Error("Failed to create test post")
  }

  testLogger.info("📝 Test post created:", {
    id: post.id,
    userId: post.userId,
    type: post.type,
    status: post.status,
  })

  return post
}

/**
 * Update post status directly in database (for testing)
 */
export async function updateTestPostStatus(
  postId: number,
  status: "AWAITING_PROCESSING" | "PROCESSED" | "DELETED",
): Promise<void> {
  const db = getTestDb()

  await db
    .update(schema.posts)
    .set({ status, updatedAt: new Date() })
    .where(sql`id = ${postId}`)

  testLogger.info("📝 Test post status updated:", { postId, status })
}

/**
 * Create test bookmark
 */
export async function createTestBookmark(bookmarkData: {
  userId: number
  postId: number
}): Promise<any> {
  const db = getTestDb()

  const [bookmark] = await db
    .insert(schema.bookmarks)
    .values(bookmarkData)
    .returning()

  if (!bookmark) {
    throw new Error("Failed to create test bookmark")
  }

  testLogger.info("📝 Test bookmark created:", {
    id: bookmark.id,
    userId: bookmark.userId,
    postId: bookmark.postId,
  })

  return bookmark
}

/**
 * Create test user with profile
 */
export async function createTestUserWithProfile(
  data: {
    web3Wallet?: string
    username?: string
    phoneNumber?: string
    ageRange?: "18-24" | "25-34" | "35-44" | "45-54" | "55+"
    occupation?: string
    city?: string
  } = {},
): Promise<{ user: User; profile: UserProfile }> {
  const username = data.username || `testuser${Date.now()}`

  const user = await createTestUser({ web3Wallet: data.web3Wallet })
  const profile = await createTestUserProfile({
    userId: user.id,
    username,
    phoneNumber: data.phoneNumber,
    ageRange: data.ageRange,
    occupation: data.occupation,
    city: data.city,
  })

  return { user, profile }
}

/**
 * Create test legal content
 */
export async function createTestLegalContent(data: {
  type: "privacy_policy" | "terms_conditions"
  title?: string
  content?: string
  version?: string
  effectiveDate?: Date
}): Promise<any> {
  const db = getTestDb()

  const defaultContent = {
    title:
      data.type === "privacy_policy"
        ? "Privacy Policy"
        : "Terms and Conditions",
    content: `<h1>Test ${data.type === "privacy_policy" ? "Privacy Policy" : "Terms"}</h1><p>Test content for ${data.type}.</p>`,
    version: "1.0",
    effectiveDate: new Date(),
    ...data,
  }

  const [legalContent] = await db
    .insert(schema.legalContent)
    .values(defaultContent)
    .returning()

  if (!legalContent) {
    throw new Error("Failed to create test legal content")
  }

  testLogger.info("📝 Test legal content created:", {
    id: legalContent.id,
    type: legalContent.type,
  })

  return legalContent
}
