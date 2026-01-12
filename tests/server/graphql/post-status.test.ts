import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestJWT } from "../../helpers/auth"
import {
  createTestPost,
  createTestUserWithProfile,
  setupTestDatabase,
  updateTestPostStatus,
} from "../../helpers/database"
import { testLogger } from "../../helpers/logger"
import {
  makeRequest,
  startTestServer,
  waitForServer,
} from "../../helpers/server"
import "../../setup"

describe("Post Status", () => {
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

    authToken = await createTestJWT(
      "0x1234567890123456789012345678901234567890",
      { extraClaims: { userId: user.id } },
    )
  })

  afterAll(async () => {
    if (testServer) {
      await testServer.shutdown()
    }
  })

  describe("createPost", () => {
    it("should create post with AWAITING_PROCESSING status", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreatePost($audioKey: String!, $duration: PositiveInt!, $tags: [String!]) {
              createPost(audioKey: $audioKey, duration: $duration, tags: $tags) {
                id
                status
                audioUrl
              }
            }
          `,
          variables: {
            audioKey: "audio/test/new-post.webm",
            duration: 45,
            tags: ["test"],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("createPost failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.createPost.status).toBe("AWAITING_PROCESSING")
      expect(body.data.createPost.audioUrl).toBeDefined()
    })
  })

  describe("createResponse", () => {
    it("should create response with AWAITING_PROCESSING status", async () => {
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
            mutation CreateResponse($parentId: PositiveInt!, $audioKey: String!, $duration: PositiveInt!, $tags: [String!]) {
              createResponse(parentId: $parentId, audioKey: $audioKey, duration: $duration, tags: $tags) {
                id
                status
                audioUrl
                type
              }
            }
          `,
          variables: {
            parentId: parentPost.id,
            audioKey: "audio/test/response.webm",
            duration: 30,
            tags: [],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("createResponse failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.createResponse.status).toBe("AWAITING_PROCESSING")
      expect(body.data.createResponse.type).toBe("RESPONSE")
    })
  })

  describe("getPosts", () => {
    it("should return status field in post summary", async () => {
      await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "PROCESSED",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPosts {
              getPosts {
                posts {
                  id
                  status
                }
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPosts failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPosts.posts.length).toBe(1)
      expect(body.data.getPosts.posts[0].status).toBe("PROCESSED")
    })

    it("should return posts of all statuses", async () => {
      await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "AWAITING_PROCESSING",
      })

      await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "PROCESSED",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPosts {
              getPosts {
                posts {
                  id
                  status
                }
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPosts failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPosts.posts.length).toBe(2)
      const statuses = body.data.getPosts.posts.map((p: any) => p.status)
      expect(statuses).toContain("AWAITING_PROCESSING")
      expect(statuses).toContain("PROCESSED")
    })
  })

  describe("getPostById", () => {
    it("should return status field in full post", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "PROCESSED",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPostById($id: PositiveInt!) {
              getPostById(id: $id) {
                id
                status
                audioUrl
                waveformUrl
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPostById failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPostById.status).toBe("PROCESSED")
      expect(body.data.getPostById.audioUrl).toBeDefined()
    })

    it("should return null audioUrl and waveformUrl for DELETED post", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
        audioUrl: "https://example.com/audio/test.webm",
        status: "PROCESSED",
      })

      await updateTestPostStatus(post.id, "DELETED")

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPostById($id: PositiveInt!) {
              getPostById(id: $id) {
                id
                status
                audioUrl
                waveformUrl
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPostById failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPostById.status).toBe("DELETED")
      expect(body.data.getPostById.audioUrl).toBeNull()
      expect(body.data.getPostById.waveformUrl).toBeNull()
    })
  })

  describe("getMyPosts", () => {
    it("should return status in my posts", async () => {
      await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "AWAITING_PROCESSING",
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyPosts {
              getMyPosts {
                posts {
                  id
                  status
                }
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getMyPosts failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getMyPosts.posts.length).toBe(1)
      expect(body.data.getMyPosts.posts[0].status).toBe("AWAITING_PROCESSING")
    })
  })

  describe("getResponses", () => {
    it("should return status in responses", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        type: "RESPONSE",
        parentId: parentPost.id,
        city: "singapore",
        status: "PROCESSED",
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
                  status
                  type
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

      expect(body.data.getResponses.posts.length).toBe(1)
      expect(body.data.getResponses.posts[0].status).toBe("PROCESSED")
      expect(body.data.getResponses.posts[0].type).toBe("RESPONSE")
    })

    it("should return null waveformUrl for DELETED response", async () => {
      const parentPost = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        type: "RESPONSE",
        parentId: parentPost.id,
        city: "singapore",
        status: "DELETED",
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
                  status
                  waveformUrl
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

      expect(body.data.getResponses.posts.length).toBe(1)
      expect(body.data.getResponses.posts[0].status).toBe("DELETED")
      expect(body.data.getResponses.posts[0].waveformUrl).toBeNull()
    })
  })

  describe("updatePostStatus (database function)", () => {
    it("should update post status from AWAITING_PROCESSING to PROCESSED", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
        status: "AWAITING_PROCESSING",
      })

      await updateTestPostStatus(post.id, "PROCESSED")

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPostById($id: PositiveInt!) {
              getPostById(id: $id) {
                id
                status
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPostById failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPostById.status).toBe("PROCESSED")
    })
  })
})
