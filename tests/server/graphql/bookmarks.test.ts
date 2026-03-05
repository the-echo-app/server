import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestJWT } from "../../helpers/auth"
import {
  createTestBookmark,
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

describe("GraphQL Bookmarks", () => {
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

  describe("bookmarkPost", () => {
    it("should bookmark a post", async () => {
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
            mutation BookmarkPost($postId: PositiveInt!) {
              bookmarkPost(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("bookmarkPost failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.bookmarkPost.success).toBe(true)

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
                isBookmarked
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const getBody = await getResponse.json()
      expect(getBody.data.getPostById.isBookmarked).toBe(true)
    })

    it("should return error for duplicate bookmark", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestBookmark({
        userId: testUserId,
        postId: post.id,
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation BookmarkPost($postId: PositiveInt!) {
              bookmarkPost(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.errors).toBeDefined()
      expect(body.errors[0].message.toLowerCase()).toContain("already")
    })
  })

  describe("removeBookmark", () => {
    it("should remove a bookmark", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestBookmark({
        userId: testUserId,
        postId: post.id,
      })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation RemoveBookmark($postId: PositiveInt!) {
              removeBookmark(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("removeBookmark failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.removeBookmark.success).toBe(true)

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
                isBookmarked
              }
            }
          `,
          variables: {
            id: post.id,
          },
        }),
      })

      const getBody = await getResponse.json()
      expect(getBody.data.getPostById.isBookmarked).toBe(false)
    })
  })

  describe("bookmarkCount", () => {
    it("should return correct bookmark count after operations", async () => {
      const post = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      const getPostQuery = {
        query: `
          query GetPostById($id: PositiveInt!) {
            getPostById(id: $id) {
              id
              bookmarkCount
            }
          }
        `,
        variables: {
          id: post.id,
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
      expect(initialBody.data.getPostById.bookmarkCount).toBe(0)

      await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation BookmarkPost($postId: PositiveInt!) {
              bookmarkPost(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
          },
        }),
      })

      const afterBookmarkResponse = await makeRequest(
        `${testServer.url}/graphql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(getPostQuery),
        },
      )

      const afterBookmarkBody = await afterBookmarkResponse.json()
      expect(afterBookmarkBody.data.getPostById.bookmarkCount).toBe(1)

      await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            mutation RemoveBookmark($postId: PositiveInt!) {
              removeBookmark(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
          },
        }),
      })

      const afterRemoveResponse = await makeRequest(
        `${testServer.url}/graphql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(getPostQuery),
        },
      )

      const afterRemoveBody = await afterRemoveResponse.json()
      expect(afterRemoveBody.data.getPostById.bookmarkCount).toBe(0)
    })
  })

  describe("getMyBookmarks", () => {
    it("should return user bookmarks", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
        tags: ["grateful"],
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
        tags: ["hopeful"],
      })

      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks {
              getMyBookmarks {
                posts {
                  id
                  tags
                  isBookmarked
                }
                hasMore
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getMyBookmarks failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getMyBookmarks.posts.length).toBe(2)
      for (const post of body.data.getMyBookmarks.posts) {
        expect(post.isBookmarked).toBe(true)
      }
    })

    it("should return empty array when no bookmarks", async () => {
      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks {
              getMyBookmarks {
                posts {
                  id
                }
                hasMore
              }
            }
          `,
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getMyBookmarks failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getMyBookmarks.posts).toBeInstanceOf(Array)
      expect(body.data.getMyBookmarks.posts.length).toBe(0)
    })

    it("should support sorting", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })

      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await new Promise((r) => setTimeout(r, 10))
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks($sortBy: SortBy) {
              getMyBookmarks(sortBy: $sortBy) {
                posts {
                  id
                }
              }
            }
          `,
          variables: {
            sortBy: "OLDEST",
          },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)

      if (body.errors) {
        testLogger.error("getMyBookmarks with sort failed:", body.errors)
        throw new Error(body.errors[0].message)
      }

      expect(body.data.getMyBookmarks.posts.length).toBe(2)
      expect(body.data.getMyBookmarks.posts[0].id).toBe(post1.id)
    })

    it("should sort bookmarks by MOST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 3 })
      await updateTestPostCounts(post2.id, { responseCount: 15 })
      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks($sortBy: SortBy) {
              getMyBookmarks(sortBy: $sortBy) {
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

      expect(body.data.getMyBookmarks.posts[0].id).toBe(post2.id)
      expect(body.data.getMyBookmarks.posts[1].id).toBe(post1.id)
    })

    it("should sort bookmarks by LEAST_RESPONSES", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { responseCount: 20 })
      await updateTestPostCounts(post2.id, { responseCount: 1 })
      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks($sortBy: SortBy) {
              getMyBookmarks(sortBy: $sortBy) {
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

      expect(body.data.getMyBookmarks.posts[0].id).toBe(post2.id)
      expect(body.data.getMyBookmarks.posts[1].id).toBe(post1.id)
    })

    it("should sort bookmarks by MOST_SAVED", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { bookmarkCount: 2 })
      await updateTestPostCounts(post2.id, { bookmarkCount: 10 })
      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks($sortBy: SortBy) {
              getMyBookmarks(sortBy: $sortBy) {
                posts { id bookmarkCount }
              }
            }
          `,
          variables: { sortBy: "MOST_SAVED" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getMyBookmarks.posts[0].id).toBe(post2.id)
      expect(body.data.getMyBookmarks.posts[1].id).toBe(post1.id)
    })

    it("should sort bookmarks by LEAST_SAVED", async () => {
      const post1 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      const post2 = await createTestPost({
        userId: testUserId,
        city: "singapore",
      })
      await updateTestPostCounts(post1.id, { bookmarkCount: 15 })
      await updateTestPostCounts(post2.id, { bookmarkCount: 1 })
      await createTestBookmark({ userId: testUserId, postId: post1.id })
      await createTestBookmark({ userId: testUserId, postId: post2.id })

      const response = await makeRequest(`${testServer.url}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `
            query GetMyBookmarks($sortBy: SortBy) {
              getMyBookmarks(sortBy: $sortBy) {
                posts { id bookmarkCount }
              }
            }
          `,
          variables: { sortBy: "LEAST_SAVED" },
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      if (body.errors) throw new Error(body.errors[0].message)

      expect(body.data.getMyBookmarks.posts[0].id).toBe(post2.id)
      expect(body.data.getMyBookmarks.posts[1].id).toBe(post1.id)
    })
  })

  describe("Authentication", () => {
    it("should reject unauthenticated bookmark request", async () => {
      const post = await createTestPost({
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
            mutation BookmarkPost($postId: PositiveInt!) {
              bookmarkPost(postId: $postId) {
                success
              }
            }
          `,
          variables: {
            postId: post.id,
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
