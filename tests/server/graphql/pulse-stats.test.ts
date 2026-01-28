import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestJWT } from "../../helpers/auth"
import { setupTestDatabase } from "../../helpers/database"
import { testLogger } from "../../helpers/logger"
import {
  makeRequest,
  startTestServer,
  waitForServer,
} from "../../helpers/server"
import "../../setup"

describe("GraphQL Pulse Stats", () => {
  let testServer: any
  let testUserId: number
  let authToken: string

  beforeAll(async () => {
    testServer = await startTestServer()
    await waitForServer(testServer.url)
  })

  beforeEach(async () => {
    await setupTestDatabase()

    // Create test user with profile
    const { createTestUser, createTestUserProfile, createTestUserAuth } =
      await import("../../helpers/database")
    const user = await createTestUser({
      web3Wallet: "0x1234567890123456789012345678901234567890",
    })
    testUserId = user.id

    await createTestUserAuth({
      userId: testUserId,
      authType: "PHONE",
      authIdentifier: "+15551234567",
    })

    await createTestUserProfile({
      userId: testUserId,
      username: "pulsetestuser",
      phoneNumber: "+15551234567",
    })

    authToken = await createTestJWT(testUserId)

    // Insert pulse stats data for testing
    const { dbManager, schema } = await import("@server/db/connection")
    const db = dbManager.getDb()

    await db.insert(schema.pulseStats).values([
      {
        city: "singapore",
        period: "7d",
        tag: "stressed",
        count: 45,
        percentage: 30.5,
      },
      {
        city: "singapore",
        period: "7d",
        tag: "happy",
        count: 35,
        percentage: 23.7,
      },
      {
        city: "singapore",
        period: "7d",
        tag: "work",
        count: 28,
        percentage: 18.9,
      },
      {
        city: "singapore",
        period: "30d",
        tag: "stressed",
        count: 120,
        percentage: 28.0,
      },
      {
        city: "singapore",
        period: "30d",
        tag: "happy",
        count: 95,
        percentage: 22.2,
      },
      {
        city: "new-york",
        period: "7d",
        tag: "stressed",
        count: 60,
        percentage: 35.0,
      },
      {
        city: "new-york",
        period: "7d",
        tag: "tired",
        count: 40,
        percentage: 23.5,
      },
    ])
  })

  afterAll(async () => {
    if (testServer) {
      await testServer.shutdown()
    }
  })

  describe("getPulseStats", () => {
    it("should return pulse stats for a city and period", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                  percentage
                }
              }
            }
          `,
          variables: {
            city: "singapore",
            period: "7d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPulseStats failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPulseStats).toBeDefined()
      expect(body.data.getPulseStats.city).toBe("singapore")
      expect(body.data.getPulseStats.period).toBe("7d")
      expect(body.data.getPulseStats.tags).toHaveLength(3)

      const stressedTag = body.data.getPulseStats.tags.find(
        (t: any) => t.tag === "stressed",
      )
      expect(stressedTag).toBeDefined()
      expect(stressedTag.count).toBe(45)
      expect(stressedTag.percentage).toBeCloseTo(30.5, 1)
    })

    it("should return different stats for different periods", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                  percentage
                }
              }
            }
          `,
          variables: {
            city: "singapore",
            period: "30d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPulseStats failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPulseStats.tags).toHaveLength(2)

      const stressedTag = body.data.getPulseStats.tags.find(
        (t: any) => t.tag === "stressed",
      )
      expect(stressedTag.count).toBe(120)
    })

    it("should return different stats for different cities", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                  percentage
                }
              }
            }
          `,
          variables: {
            city: "new-york",
            period: "7d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPulseStats failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPulseStats.city).toBe("new-york")
      expect(body.data.getPulseStats.tags).toHaveLength(2)

      const tiredTag = body.data.getPulseStats.tags.find(
        (t: any) => t.tag === "tired",
      )
      expect(tiredTag).toBeDefined()
      expect(tiredTag.count).toBe(40)
    })

    it("should allow pulse stats with zero count and percentage", async () => {
      const { dbManager, schema } = await import("@server/db/connection")
      const db = dbManager.getDb()

      await db.insert(schema.pulseStats).values({
        city: "test-city",
        period: "7d",
        tag: "zero-tag",
        count: 0,
        percentage: 0,
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                  percentage
                }
              }
            }
          `,
          variables: {
            city: "test-city",
            period: "7d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPulseStats with zero count failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPulseStats.tags).toHaveLength(1)
      const zeroTag = body.data.getPulseStats.tags[0]
      expect(zeroTag.tag).toBe("zero-tag")
      expect(zeroTag.count).toBe(0)
      expect(zeroTag.percentage).toBe(0)
    })

    it("should return empty tags array for city/period with no data", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                  percentage
                }
              }
            }
          `,
          variables: {
            city: "london",
            period: "7d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPulseStats failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPulseStats.city).toBe("london")
      expect(body.data.getPulseStats.period).toBe("7d")
      expect(body.data.getPulseStats.tags).toHaveLength(0)
    })

    it("should require authentication", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query GetPulseStats($city: String!, $period: String!) {
              getPulseStats(city: $city, period: $period) {
                city
                period
                tags {
                  tag
                  count
                }
              }
            }
          `,
          variables: {
            city: "singapore",
            period: "7d",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].message.toLowerCase()).toContain("auth")
    })
  })
})
