// Ported and modified from swc-project/plugins (Apache-2.0).
// Upstream adapted this transform from Codex-/swc-plugin-import-meta-env by Alex Miller.
// AST views: numeric walker callbacks and a NodeView field setter.
import { Field, NodeKind } from '@swc-next/core/ffi2';
import { createWalker } from '@swc-next/walker2';
import { identifier } from './formatjs/ast.js';

const walker = createWalker({
  MemberExpression(ctx) {
    const node = ctx.node;
    const object = node.object;
    if (!node.computed && !node.optional && node.property.typeId === NodeKind.IdentifierName
      && node.childStringEquals(Field.property, Field.name, 'env') && object.typeId === NodeKind.MetaProperty
      && object.childStringEquals(Field.meta, Field.name, 'import') && object.childStringEquals(Field.property, Field.name, 'meta')) {
      node.object = identifier('process', object);
    }
  },
});

export function importMetaEnv() {
  return function importMetaEnvPlugin(program) { walker.walk(program); };
}

export default importMetaEnv;
