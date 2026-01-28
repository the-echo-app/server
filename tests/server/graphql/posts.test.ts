import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
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

describe("GraphQL Posts", () => {
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

  describe("getPosts", () => {
    it("should return paginated posts", async () => {
      await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/test1.webm",
        audioKey: "audio/test/test1.webm",
        duration: 30,
        tags: ["test", "hello"],
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/test2.webm",
        audioKey: "audio/test/test2.webm",
        duration: 45,
        tags: ["world"],
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
            query GetPosts($city: String, $limit: PositiveInt) {
              getPosts(city: $city, limit: $limit) {
                posts {
                  id
                  duration
                  tags
                  createdAt
                  author {
                    id
                    username
                  }
                }
                nextCursor
                hasMore
              }
            }
          `,
          variables: {
            city: "singapore",
            limit: 10,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getPosts query failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPosts).toBeDefined()
      expect(body.data.getPosts.posts).toBeInstanceOf(Array)
      expect(body.data.getPosts.posts.length).toBe(2)
      expect(body.data.getPosts.posts[0].author.username).toBe("testuser")
    })

    it("should return posts without tags filter", async () => {
      await createTestPost({
        userId: testUserId,
        tags: ["stressed", "work"],
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        tags: ["happy", "weekend"],
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
            query GetPosts {
              getPosts {
                posts {
                  id
                  tags
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
    })
  })

  describe("getPostById", () => {
    it("should return posts with zero response and bookmark counts", async () => {
      const post = await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/fresh.webm",
        audioKey: "audio/test/fresh.webm",
        duration: 30,
        tags: ["new"],
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
            query GetPostById($id: PositiveInt!) {
              getPostById(id: $id) {
                id
                responseCount
                bookmarkCount
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
        testLogger.error("getPostById with zero counts failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getPostById).toBeDefined()
      expect(body.data.getPostById.responseCount).toBe(0)
      expect(body.data.getPostById.bookmarkCount).toBe(0)
    })

    it("should return a single post with audio URL", async () => {
      const post = await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/test.webm",
        audioKey: "audio/test/test.webm",
        duration: 30,
        tags: ["test"],
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
            query GetPostById($id: PositiveInt!) {
              getPostById(id: $id) {
                id
                audioUrl
                duration
                tags
                city
                isBookmarked
                author {
                  id
                  username
                }
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

      expect(body.data.getPostById).toBeDefined()
      expect(body.data.getPostById.id).toBe(post.id)
      expect(body.data.getPostById.audioUrl).toBe(
        "https://example.com/audio/test.webm",
      )
      expect(body.data.getPostById.duration).toBe(30)
    })

    it("should return null for non-existent post", async () => {
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
              }
            }
          `,
          variables: {
            id: 99999,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.data.getPostById).toBeNull()
    })
  })

  describe("getMyPosts", () => {
    it("should return current user posts", async () => {
      await createTestPost({ userId: testUserId, city: "singapore" })
      await createTestPost({ userId: testUserId, city: "singapore" })

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
                  author {
                    id
                  }
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

      expect(body.data.getMyPosts.posts.length).toBe(2)
      for (const post of body.data.getMyPosts.posts) {
        expect(post.author.id).toBe(testUserId)
      }
    })
  })

  describe("createPost", () => {
    it("should create a new post", async () => {
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
                audioUrl
                duration
                tags
                type
                author {
                  id
                  username
                }
              }
            }
          `,
          variables: {
            audioKey: "audio/test/new-post.webm",
            duration: 45,
            tags: ["excited", "morning"],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("createPost failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.createPost).toBeDefined()
      expect(body.data.createPost.id).toBeDefined()
      expect(body.data.createPost.duration).toBe(45)
      expect(body.data.createPost.tags).toContain("excited")
      expect(body.data.createPost.type).toBe("POST")
      expect(body.data.createPost.author.id).toBe(testUserId)
    })
  })

  describe("deletePost", () => {
    it("should delete own post", async () => {
      const post = await createTestPost({
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
            mutation DeletePost($id: PositiveInt!) {
              deletePost(id: $id) {
                success
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
        testLogger.error("deletePost failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.deletePost.success).toBe(true)

      const getResponse = await makeRequest(`${testServer.url}/graphql`, {
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
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const getBody = await getResponse.json()
      expect(getBody.data.getPostById).toBeNull()
    })

    it("should not delete another user post", async () => {
      const { user: otherUser } = await createTestUserWithProfile({
        username: "otheruser",
        web3Wallet: "0xaabbccdd00000000000000000000000000000000",
      })

      const post = await createTestPost({
        userId: otherUser.id,
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
            mutation DeletePost($id: PositiveInt!) {
              deletePost(id: $id) {
                success
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
      expect(body.errors).toBeDefined()
    })
  })

  describe("Authentication", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query GetPosts {
              getPosts {
                posts {
                  id
                }
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].extensions?.code).toBe("UNAUTHORIZED")
    })
  })
})
