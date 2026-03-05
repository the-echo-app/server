import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestJWT } from "../../helpers/auth"
import {
  createTestPost,
  createTestUserWithProfile,
  setupTestDatabase,
  updateTestPostCounts,
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
        tags: ["grateful"],
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/test2.webm",
        audioKey: "audio/test/test2.webm",
        duration: 45,
        tags: ["hopeful"],
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
        tags: ["stressed"],
        city: "singapore",
      })

      await createTestPost({
        userId: testUserId,
        tags: ["joyful"],
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

    it("should filter posts by a single tag", async () => {
      await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      await createTestPost({
        userId: testUserId,
        tags: ["stressed"],
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
            query GetPosts($tags: [String!]) {
              getPosts(tags: $tags) {
                posts { id tags }
              }
            }
          `,
          variables: { tags: ["grateful"] },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts.length).toBe(1)
      expect(body.data.getPosts.posts[0].tags).toEqual(["grateful"])
    })

    it("should filter posts by multiple tags", async () => {
      await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      await createTestPost({
        userId: testUserId,
        tags: ["stressed"],
        city: "singapore",
      })
      await createTestPost({
        userId: testUserId,
        tags: ["hopeful"],
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
            query GetPosts($tags: [String!]) {
              getPosts(tags: $tags) {
                posts { id tags }
              }
            }
          `,
          variables: { tags: ["grateful", "hopeful"] },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts.length).toBe(2)
      const returnedTags = body.data.getPosts.posts.map((p: any) => p.tags[0])
      expect(returnedTags).toContain("grateful")
      expect(returnedTags).toContain("hopeful")
    })

    it("should return empty when no posts match tag filter", async () => {
      await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
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
            query GetPosts($tags: [String!]) {
              getPosts(tags: $tags) {
                posts { id }
              }
            }
          `,
          variables: { tags: ["stressed"] },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts.length).toBe(0)
    })

    it("should sort posts by NEWEST (default)", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      await new Promise((r) => setTimeout(r, 10))
      const post2 = await createTestPost({
        userId: testUserId,
        tags: ["hopeful"],
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
                posts { id }
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts[0].id).toBe(post2.id)
      expect(body.data.getPosts.posts[1].id).toBe(post1.id)
    })

    it("should sort posts by OLDEST", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      await new Promise((r) => setTimeout(r, 10))
      const post2 = await createTestPost({
        userId: testUserId,
        tags: ["hopeful"],
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
            query GetPosts($sortBy: SortBy) {
              getPosts(sortBy: $sortBy) {
                posts { id }
              }
            }
          `,
          variables: { sortBy: "OLDEST" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts[0].id).toBe(post1.id)
      expect(body.data.getPosts.posts[1].id).toBe(post2.id)
    })

    it("should sort posts by MOST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        tags: ["hopeful"],
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 5 })
      await updateTestPostCounts(post2.id, { responseCount: 10 })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPosts($sortBy: SortBy) {
              getPosts(sortBy: $sortBy) {
                posts { id responseCount }
              }
            }
          `,
          variables: { sortBy: "MOST_RESPONSES" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts[0].id).toBe(post2.id)
      expect(body.data.getPosts.posts[1].id).toBe(post1.id)
    })

    it("should sort posts by LEAST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        tags: ["grateful"],
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        tags: ["hopeful"],
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 10 })
      await updateTestPostCounts(post2.id, { responseCount: 3 })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetPosts($sortBy: SortBy) {
              getPosts(sortBy: $sortBy) {
                posts { id responseCount }
              }
            }
          `,
          variables: { sortBy: "LEAST_RESPONSES" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getPosts.posts[0].id).toBe(post2.id)
      expect(body.data.getPosts.posts[1].id).toBe(post1.id)
    })
  })

  describe("getPostById", () => {
    it("should return posts with zero response and bookmark counts", async () => {
      const post = await createTestPost({
        userId: testUserId,
        audioUrl: "https://example.com/audio/fresh.webm",
        audioKey: "audio/test/fresh.webm",
        duration: 30,
        tags: ["excited"],
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
        tags: ["peaceful"],
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
      expect(body.data.getPostById.tags).toEqual(["peaceful"])
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

    it("should sort my posts by MOST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 2 })
      await updateTestPostCounts(post2.id, { responseCount: 8 })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyPosts($sortBy: SortBy) {
              getMyPosts(sortBy: $sortBy) {
                posts { id responseCount }
              }
            }
          `,
          variables: { sortBy: "MOST_RESPONSES" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getMyPosts.posts[0].id).toBe(post2.id)
      expect(body.data.getMyPosts.posts[1].id).toBe(post1.id)
    })

    it("should sort my posts by LEAST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 10 })
      await updateTestPostCounts(post2.id, { responseCount: 1 })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyPosts($sortBy: SortBy) {
              getMyPosts(sortBy: $sortBy) {
                posts { id responseCount }
              }
            }
          `,
          variables: { sortBy: "LEAST_RESPONSES" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getMyPosts.posts[0].id).toBe(post2.id)
      expect(body.data.getMyPosts.posts[1].id).toBe(post1.id)
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
            tags: ["excited"],
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
      expect(body.data.createPost.tags).toEqual(["excited"])
      expect(body.data.createPost.type).toBe("POST")
      expect(body.data.createPost.author.id).toBe(testUserId)
    })

    it("should reject post with no tags", async () => {
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
              }
            }
          `,
          variables: {
            audioKey: "audio/test/no-tags.webm",
            duration: 30,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].message).toContain("exactly one sentiment tag")
    })

    it("should reject post with multiple tags", async () => {
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
              }
            }
          `,
          variables: {
            audioKey: "audio/test/multi-tags.webm",
            duration: 30,
            tags: ["grateful", "hopeful"],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].message).toContain("exactly one sentiment tag")
    })

    it("should reject post with invalid sentiment tag", async () => {
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
              }
            }
          `,
          variables: {
            audioKey: "audio/test/invalid-tag.webm",
            duration: 30,
            tags: ["not-a-valid-tag"],
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].message).toContain("Invalid sentiment tag")
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
