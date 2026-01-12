/**
 * Time constants for use across client and server code
 */
export const ONE_SECOND = 1000
export const ONE_MINUTE = 60 * ONE_SECOND
export const THIRTY_MINUTES = 30 * ONE_MINUTE
export const ONE_HOUR = 60 * ONE_MINUTE

/**
 * OAuth authentication methods
 */
export const OAUTH_METHOD = {
  GOOGLE: "GOOGLE",
  FACEBOOK: "FACEBOOK",
  GITHUB: "GITHUB",
  X: "X",
  TIKTOK: "TIKTOK",
  LINKEDIN: "LINKEDIN",
} as const

export type OAuthMethod = (typeof OAUTH_METHOD)[keyof typeof OAUTH_METHOD]

/**
 * All authentication method types
 */
export const AUTH_METHOD = {
  WEB3_WALLET: "WEB3_WALLET",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  ...OAUTH_METHOD,
} as const

export type AuthMethod = (typeof AUTH_METHOD)[keyof typeof AUTH_METHOD]

/**
 * Age range options for user profiles
 */
export const AGE_RANGE = {
  AGE_18_24: "18-24",
  AGE_25_34: "25-34",
  AGE_35_44: "35-44",
  AGE_45_54: "45-54",
  AGE_55_PLUS: "55+",
} as const

export type AgeRange = (typeof AGE_RANGE)[keyof typeof AGE_RANGE]

/**
 * Post types for audio content
 */
export const POST_TYPE = {
  POST: "POST",
  RESPONSE: "RESPONSE",
} as const

export type PostType = (typeof POST_TYPE)[keyof typeof POST_TYPE]

/**
 * Post processing status
 */
export const POST_STATUS = {
  AWAITING_PROCESSING: "AWAITING_PROCESSING",
  PROCESSED: "PROCESSED",
  DELETED: "DELETED",
} as const

export type PostStatus = (typeof POST_STATUS)[keyof typeof POST_STATUS]

/**
 * Legal content types
 */
export const LEGAL_CONTENT_TYPE = {
  PRIVACY_POLICY: "privacy_policy",
  TERMS_CONDITIONS: "terms_conditions",
} as const

export type LegalContentType =
  (typeof LEGAL_CONTENT_TYPE)[keyof typeof LEGAL_CONTENT_TYPE]

/**
 * Notification alert types
 */
export const NOTIFICATION_TYPE = {
  RESPONSE: "RESPONSE",
  SYSTEM: "SYSTEM",
} as const

export type NotificationType =
  (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE]

/**
 * Email verification settings
 */
export const EMAIL_VERIFICATION_CODE_EXPIRY_MS = ONE_HOUR
export const EMAIL_VERIFICATION_CODE_MIN = 100000
export const EMAIL_VERIFICATION_CODE_MAX = 999999
