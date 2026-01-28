import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { POST_TYPE } from "../../../src/shared/constants"
import { createTestJWT } from "../../helpers/auth"
import {
  createTestPost,
  createTestUserWithProfile,
  setupTestDatabase,
} from "../../helpers/database"
import { testLogger } from "../../helpers/logger"
import {
  makeRequest,
  startTestServer,
  waitForServer,
} from "../../helpers/server"
import "../../setup"

describe("GraphQL Responses", () => {
  let testServer: any
  let authToken: string
  let testUserId: number

  beforeAll(async () => {
    testServer = await startTestServer()
    await waitForServer(testServer.url)
  })

  beforeEach(async () => {
    await setupTestDatabase()

    const { user } = await createTestUserWithProfile({
      username: "testuser",
      web3Wallet: "0x1234567890123456789012345678901234567890",
    })
    testUserId = user.id

    authToken = await createTestJWT(user.id)
  })

  afterAll(async () => {
    if (testServer) {
      await testServer.shutdown()
    }
  })

  describe("createResponse", () => {
    it("should create a response to a post", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
        tags: ["question"],
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!, $tags: [String!]) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration, tags: $tags) {
                id
                type
                parentId
                duration
                tags
                author {
                  id
                  username
                }
              }
            }
          `,
          variables: {
            parentId: parentPost.id,
            audioKey: "audio/test/response.webm",
            duration: 20,
            tags: ["answer"],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("createResponse failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.createResponse).toBeDefined()
      expect(body.data.createResponse.type).toBe("RESPONSE")
      expect(body.data.createResponse.parentId).toBe(parentPost.id)
      expect(body.data.createResponse.duration).toBe(20)
      expect(body.data.createResponse.tags).toContain("answer")
    })

    it("should return correct response count after creating response", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const getPostQuery = {
        query: `
          query GetPostById($id: PositiveInt!) {
            getPostById(id: $id) {
              id
              responseCount
            }
          }
        `,
        variables: {
          id: parentPost.id,
        },
      }

      const initialResponse = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(getPostQuery),
      })

      const initialBody = await initialResponse.json()
      expect(initialResponse.status).toBe(200)

      if (initialBody.errors) {
        testLogger.error("getPostById failed:", initialBody.errors)
        throw new Error(initialBody.errors[0].message)
      }

      expect(initialBody.data.getPostById.responseCount).toBe(0)

      await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration) {
                id
              }
            }
          `,
          variables: {
            parentId: parentPost.id,
            audioKey: "audio/test/response-count.webm",
            duration: 15,
          },
        }),
      })

      const afterResponse = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(getPostQuery),
      })

      const afterBody = await afterResponse.json()
      expect(afterBody.data.getPostById.responseCount).toBe(1)
    })

    it("should increment parent post response count", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const createResp = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration) {
                id
                parentId
              }
            }
          `,
          variables: {
            parentId: parentPost.id,
            audioKey: "audio/test/response1.webm",
            duration: 15,
          },
        }),
      })

      const createBody = await createResp.json()
      expect(createResp.status).toBe(200)

      if (createBody.errors) {
        testLogger.error("createResponse failed:", createBody.errors)
        throw new Error(createBody.errors[0].message)
      }

      expect(createBody.data.createResponse.parentId).toBe(parentPost.id)

      const getResponse = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetResponses($postId: PositiveInt!) {
              getResponses(postId: $postId) {
                posts {
                  id
                }
              }
            }
          `,
          variables: {
            postId: parentPost.id,
          },
        }),
      })

      const getBody = await getResponse.json()
      expect(getBody.data.getResponses.posts.length).toBe(1)
    })

    it("should fail for non-existent parent post", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration) {
                id
              }
            }
          `,
          variables: {
            parentId: 99999,
            audioKey: "audio/test/response.webm",
            duration: 15,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
    })
  })

  describe("getResponses", () => {
    it("should return responses to a post", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        type: POST_TYPE.RESPONSE,
        parentId: parentPost.id,
        city: "singapore",
        tags: ["response1"],
      })

      await createTestPost({
        userId: testUserId,
        type: POST_TYPE.RESPONSE,
        parentId: parentPost.id,
        city: "singapore",
        tags: ["response2"],
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetResponses($postId: PositiveInt!) {
              getResponses(postId: $postId) {
                posts {
                  id
                  type
                  parentId
                  tags
                  author {
                    id
                    username
                  }
                }
                hasMore
              }
            }
          `,
          variables: {
            postId: parentPost.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getResponses failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getResponses.posts.length).toBe(2)
      for (const post of body.data.getResponses.posts) {
        expect(post.type).toBe("RESPONSE")
        expect(post.parentId).toBe(parentPost.id)
      }
    })

    it("should support sorting responses", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const response1 = await createTestPost({
        userId: testUserId,
        type: POST_TYPE.RESPONSE,
        parentId: parentPost.id,
        city: "singapore",
      })

      await new Promise((r) => setTimeout(r, 10))

      const _response2 = await createTestPost({
        userId: testUserId,
        type: POST_TYPE.RESPONSE,
        parentId: parentPost.id,
        city: "singapore",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetResponses($postId: PositiveInt!, $sortBy: SortBy) {
              getResponses(postId: $postId, sortBy: $sortBy) {
                posts {
                  id
                }
              }
            }
          `,
          variables: {
            postId: parentPost.id,
            sortBy: "OLDEST",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getResponses with sort failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getResponses.posts.length).toBe(2)
      expect(body.data.getResponses.posts[0].id).toBe(response1.id)
    })

    it("should return empty array for post with no responses", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetResponses($postId: PositiveInt!) {
              getResponses(postId: $postId) {
                posts {
                  id
                }
              }
            }
          `,
          variables: {
            postId: parentPost.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getResponses failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getResponses.posts).toBeInstanceOf(Array)
      expect(body.data.getResponses.posts.length).toBe(0)
    })

    it("should support pagination", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      for (let i = 0; i < 5; i++) {
        await createTestPost({
          userId: testUserId,
          type: POST_TYPE.RESPONSE,
          parentId: parentPost.id,
          city: "singapore",
        })
      }

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetResponses($postId: PositiveInt!, $limit: PositiveInt) {
              getResponses(postId: $postId, limit: $limit) {
                posts {
                  id
                }
                hasMore
                nextCursor
              }
            }
          `,
          variables: {
            postId: parentPost.id,
            limit: 2,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getResponses pagination failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getResponses.posts.length).toBe(2)
      expect(body.data.getResponses.hasMore).toBe(true)
      expect(body.data.getResponses.nextCursor).toBeDefined()
    })
  })

  describe("Authentication", () => {
    it("should reject unauthenticated response creation", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration) {
                id
              }
            }
          `,
          variables: {
            parentId: parentPost.id,
            audioKey: "audio/test/response.webm",
            duration: 15,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].extensions?.code).toBe("UNAUTHORIZED")
    })
  })
})
