import { getGraphQLClient, setAuthToken } from "@shared/graphql/client"
import { VALIDATE_TOKEN } from "@shared/graphql/queries"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react"

interface AuthResult {
  success: boolean
  token: string | null
  error: string | null
}

const STORAGE_KEYS = {
  AUTH_TOKEN: "auth_token",
} as const

const getAuthFromStorage = () => {
  return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
}

const clearAuthFromStorage = () => {
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN)
}

export enum AuthStatus {
  IDLE = "idle",
  RESTORING = "restoring",
  AUTHENTICATING = "authenticating",
  AUTHENTICATED = "authenticated",
  ERROR = "error",
}

enum AuthActionType {
  AUTH_START = "AUTH_START",
  AUTH_SUCCESS = "AUTH_SUCCESS",
  AUTH_ERROR = "AUTH_ERROR",
  LOGOUT = "LOGOUT",
  RESTORE_START = "RESTORE_START",
  RESTORE_COMPLETE = "RESTORE_COMPLETE",
}

type AuthState =
  | { status: AuthStatus.IDLE }
  | { status: AuthStatus.RESTORING }
  | { status: AuthStatus.AUTHENTICATING }
  | { status: AuthStatus.AUTHENTICATED; token: string }
  | { status: AuthStatus.ERROR; error: string }

type AuthAction =
  | { type: AuthActionType.AUTH_START }
  | { type: AuthActionType.AUTH_SUCCESS; payload: { token: string } }
  | { type: AuthActionType.AUTH_ERROR; payload: { error: string } }
  | { type: AuthActionType.LOGOUT }
  | { type: AuthActionType.RESTORE_START }
  | { type: AuthActionType.RESTORE_COMPLETE }

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case AuthActionType.AUTH_START:
      return { status: AuthStatus.AUTHENTICATING }

    case AuthActionType.AUTH_SUCCESS:
      return {
        status: AuthStatus.AUTHENTICATED,
        token: action.payload.token,
      }

    case AuthActionType.AUTH_ERROR:
      return {
        status: AuthStatus.ERROR,
        error: action.payload.error,
      }

    case AuthActionType.LOGOUT:
      return { status: AuthStatus.IDLE }

    case AuthActionType.RESTORE_START:
      return { status: AuthStatus.RESTORING }

    case AuthActionType.RESTORE_COMPLETE:
      return { status: AuthStatus.IDLE }

    default:
      return state
  }
}

const initialState: AuthState = {
  status: AuthStatus.IDLE,
}

interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null
  authToken: string | null
  walletAddress: string | null
  userRejectedAuth: boolean
  authenticate: (address: string) => Promise<AuthResult>
  logout: () => void
  restoreAuth: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, dispatch] = useReducer(authReducer, initialState)
  const restorationStarted = useRef(false)

  const logout = useCallback(() => {
    setAuthToken(null)
    dispatch({ type: AuthActionType.LOGOUT })
    clearAuthFromStorage()
  }, [])

  const restoreAuth = useCallback(async () => {
    dispatch({ type: AuthActionType.RESTORE_START })

    const token = getAuthFromStorage()

    if (token) {
      try {
        setAuthToken(token)
        const graphqlClient = getGraphQLClient()
        const response = (await graphqlClient.request(VALIDATE_TOKEN)) as {
          validateToken: { valid: boolean }
        }

        if (response.validateToken.valid) {
          dispatch({
            type: AuthActionType.AUTH_SUCCESS,
            payload: { token },
          })
        } else {
          clearAuthFromStorage()
          setAuthToken(null)
          dispatch({ type: AuthActionType.RESTORE_COMPLETE })
        }
      } catch {
        clearAuthFromStorage()
        setAuthToken(null)
        dispatch({ type: AuthActionType.RESTORE_COMPLETE })
      }
    } else {
      dispatch({ type: AuthActionType.RESTORE_COMPLETE })
    }
  }, [])

  const authenticate = useCallback(async (): Promise<AuthResult> => {
    return {
      success: false,
      token: null,
      error: "Authentication method not configured",
    }
  }, [])

  useEffect(() => {
    if (authState.status === AuthStatus.IDLE && !restorationStarted.current) {
      restorationStarted.current = true
      restoreAuth().catch(() => {
        dispatch({ type: AuthActionType.RESTORE_COMPLETE })
      })
    }
  }, [authState.status, restoreAuth])

  const isAuthenticated = authState.status === AuthStatus.AUTHENTICATED
  const isLoading =
    authState.status === AuthStatus.AUTHENTICATING ||
    authState.status === AuthStatus.RESTORING

  const contextValue = useMemo(
    () => ({
      isAuthenticated,
      isLoading,
      error: null,
      authToken:
        authState.status === AuthStatus.AUTHENTICATED ? authState.token : null,
      walletAddress: null,
      userRejectedAuth: false,
      authenticate,
      logout,
      restoreAuth,
    }),
    [isAuthenticated, isLoading, authState, authenticate, logout, restoreAuth],
  )

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider")
  }
  return context
}
