import {
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

// PostgreSQL enums
export const ageRangeEnum = pgEnum("age_range", [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55+",
])

export const postTypeEnum = pgEnum("post_type", ["POST", "RESPONSE"])

export const postStatusEnum = pgEnum("post_status", [
  "AWAITING_PROCESSING",
  "PROCESSED",
  "DELETED",
])

// Settings table for application configuration
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").unique().notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// Users table for authentication and user management
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  disabled: boolean("disabled").default(false).notNull(),
  settings: json("settings"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// User authentication methods table
export const userAuth = pgTable(
  "user_auth",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    authType: text("auth_type").notNull(),
    authIdentifier: text("auth_identifier").unique().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    authLookupIdx: index("user_auth_type_identifier_idx").on(
      table.authType,
      table.authIdentifier,
    ),
  }),
)

// Notifications table for user notifications
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  data: json("data").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// Worker jobs table for background task management
export const workerJobs = pgTable("worker_jobs", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  type: text("type").notNull(),
  userId: integer("user_id").notNull(),
  data: json("data").notNull(),
  due: timestamp("due", { withTimezone: true }).notNull(),
  started: timestamp("started", { withTimezone: true }),
  finished: timestamp("finished", { withTimezone: true }),
  removeAt: timestamp("remove_at", { withTimezone: true }).notNull(),
  success: boolean("success"),
  result: json("result"),
  cronSchedule: text("cron_schedule"),
  autoRescheduleOnFailure: boolean("auto_reschedule_on_failure")
    .default(false)
    .notNull(),
  autoRescheduleOnFailureDelay: integer("auto_reschedule_on_failure_delay")
    .default(0)
    .notNull(),
  removeDelay: integer("remove_delay").default(0).notNull(),
  rescheduledFromJob: integer("rescheduled_from_job"),
  persistent: boolean("persistent").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// User profiles for extended user data
export const userProfiles = pgTable(
  "user_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .unique()
      .notNull(),
    username: text("username").unique().notNull(),
    phoneNumber: text("phone_number").unique().notNull(),
    ageRange: ageRangeEnum("age_range"),
    occupation: text("occupation"),
    city: text("city").default("singapore").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    usernameIdx: index("user_profiles_username_idx").on(table.username),
    phoneNumberIdx: index("user_profiles_phone_number_idx").on(
      table.phoneNumber,
    ),
    cityIdx: index("user_profiles_city_idx").on(table.city),
  }),
)

// Posts table for audio content (both posts and responses)
export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: postTypeEnum("type").notNull(),
    parentId: integer("parent_id").references((): any => posts.id, {
      onDelete: "cascade",
    }),
    audioUrl: text("audio_url").notNull(),
    audioKey: text("audio_key").notNull(),
    duration: integer("duration").notNull(),
    tags: jsonb("tags").default([]).notNull(),
    waveformUrl: text("waveform_url"),
    responseCount: integer("response_count").default(0).notNull(),
    bookmarkCount: integer("bookmark_count").default(0).notNull(),
    city: text("city").default("singapore").notNull(),
    active: boolean("active").default(true).notNull(),
    status: postStatusEnum("status").default("AWAITING_PROCESSING").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("posts_user_id_idx").on(table.userId),
    cityIdx: index("posts_city_idx").on(table.city),
    typeIdx: index("posts_type_idx").on(table.type),
    parentIdIdx: index("posts_parent_id_idx").on(table.parentId),
    createdAtIdx: index("posts_created_at_idx").on(table.createdAt),
    activeIdx: index("posts_active_idx").on(table.active),
    statusIdx: index("posts_status_idx").on(table.status),
    bookmarkCountIdx: index("posts_bookmark_count_idx").on(table.bookmarkCount),
    responseCountIdx: index("posts_response_count_idx").on(table.responseCount),
  }),
)

// Bookmarks for saved posts
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    postId: integer("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userPostUnique: unique("bookmarks_user_post_unique").on(
      table.userId,
      table.postId,
    ),
    userIdIdx: index("bookmarks_user_id_idx").on(table.userId),
  }),
)

// Pulse stats for tag analytics by city and period
export const pulseStats = pgTable(
  "pulse_stats",
  {
    id: serial("id").primaryKey(),
    city: text("city").notNull(),
    period: text("period").notNull(),
    tag: text("tag").notNull(),
    count: integer("count").default(0).notNull(),
    percentage: real("percentage").default(0).notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    cityPeriodIdx: index("pulse_stats_city_period_idx").on(
      table.city,
      table.period,
    ),
  }),
)

// Legal content for privacy policy and terms
export const legalContent = pgTable("legal_content", {
  id: serial("id").primaryKey(),
  type: text("type").unique().notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  version: text("version").notNull(),
  effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// Export types for use in application
export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type UserAuth = typeof userAuth.$inferSelect
export type NewUserAuth = typeof userAuth.$inferInsert

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

export type WorkerJob = typeof workerJobs.$inferSelect
export type NewWorkerJob = typeof workerJobs.$inferInsert

export type UserProfile = typeof userProfiles.$inferSelect
export type NewUserProfile = typeof userProfiles.$inferInsert

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert

export type Bookmark = typeof bookmarks.$inferSelect
export type NewBookmark = typeof bookmarks.$inferInsert

export type PulseStat = typeof pulseStats.$inferSelect
export type NewPulseStat = typeof pulseStats.$inferInsert

export type LegalContent = typeof legalContent.$inferSelect
export type NewLegalContent = typeof legalContent.$inferInsert
