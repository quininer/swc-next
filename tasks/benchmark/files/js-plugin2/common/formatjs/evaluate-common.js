// Pure evaluation helpers used by the FormatJS plugin.
// Helpers for native SWC Next node views.
import { NodeKind } from '@swc-next/core/ffi2';
export const UNKNOWN = Symbol('not statically evaluable');

export const wrappers = new Set([
  NodeKind.ParenthesizedExpression,
  NodeKind.TsAsExpression,
  NodeKind.TsTypeAssertion,
  NodeKind.TsNonNullExpression,
  NodeKind.TsSatisfiesExpression,
  NodeKind.TsInstantiationExpression,
]);

export const functions = new Set([
  NodeKind.Function,
  NodeKind.ArrowFunctionExpression,
  NodeKind.TsFunction,
]);

export function unwrap(node) {
  while (node && wrappers.has(node.typeId)) { node = node.expression; }
  return node;
}
