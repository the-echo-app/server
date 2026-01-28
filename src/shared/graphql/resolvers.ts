// Recommended by: https://the-guild.dev/graphql/scalars/docs/scalars/big-int
import "json-bigint-patch"

import {
  GraphQLBigInt,
  GraphQLDateTime,
  GraphQLJSON,
  GraphQLNonNegativeInt,
  GraphQLPositiveInt,
} from "graphql-scalars"

export const defaultResolvers = {
  // Scalar resolvers
  BigInt: GraphQLBigInt,
  DateTime: GraphQLDateTime,
  JSON: GraphQLJSON,
  NonNegativeInt: GraphQLNonNegativeInt,
  PositiveInt: GraphQLPositiveInt,
}
