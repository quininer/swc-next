// Static evaluation ported and modified from swc-project/plugins (Apache-2.0).
// AST views: numeric node IDs key the scopes; no NodeView is created
// just to look a binding up.
import { Field, NodeKind } from '@swc-next/core/ffi2';
import { createWalker, NONE } from '@swc-next/walker2';
import { UNKNOWN, unwrap, functions } from '../common/formatjs/evaluate-common.js';
import { EvaluatorBase } from '../common/formatjs/evaluator-base.js';

export { UNKNOWN, unwrap };

const emptyEvaluator = Symbol('empty evaluator');

function declarePattern(pattern, scope) {
  if (!pattern) { return; }
  const type = pattern.typeId;
  // Identifier patterns dominate declarations; keep them out of the switch.
  if (type === NodeKind.BindingIdentifier) {
    if (!scope.bindings.has(pattern.name)) { scope.bindings.set(pattern.name, { imported: undefined }); }
    return;
  }
  switch (type) {
    case NodeKind.FormalParameter: declarePattern(pattern.pattern, scope); break;
    case NodeKind.AssignmentPattern: declarePattern(pattern.left, scope); break;
    case NodeKind.BindingRestElement:
    case NodeKind.FormalParameterRest: declarePattern(pattern.argument, scope); break;
    case NodeKind.ArrayPattern:
      for (const element of pattern.elements) { declarePattern(element, scope); }
      declarePattern(pattern.rest, scope);
      break;
    case NodeKind.ObjectPattern:
      for (const property of pattern.properties) { declarePattern(property.value, scope); }
      declarePattern(pattern.rest, scope);
      break;
    case NodeKind.TsParameterProperty: declarePattern(pattern.parameter, scope); break;
  }
}

const scopeWalker = createWalker({
  enter(ctx) {
    const state = ctx.state;
    const type = ctx.kind;
    // Identifiers dominate the walk; they only need a scope entry.
    if (type === NodeKind.IdentifierReference || type === NodeKind.BindingIdentifier || type === NodeKind.IdentifierName ||
        type === NodeKind.LabelIdentifier || type === NodeKind.JsxIdentifier) {
      const scope = state.scope;
      if (scope !== undefined) { state.evaluator.scopeIds[ctx.nodeId] = scope.index + 1; }
      return;
    }
    let scope = state.scope;
    const isFunction = functions.has(type);
    const opens = type === NodeKind.Program || isFunction || type === NodeKind.BlockStatement || type === NodeKind.FunctionBody
      || type === NodeKind.CatchClause || type === NodeKind.ForStatement || type === NodeKind.ForInStatement || type === NodeKind.ForOfStatement
      || type === NodeKind.SwitchStatement || type === NodeKind.Class || type === NodeKind.StaticBlock;
    const node = isFunction || type === NodeKind.Class || type === NodeKind.TsEnumDeclaration || type === NodeKind.CatchClause
      || type === NodeKind.ImportDeclaration || type === NodeKind.VariableDeclarator ? ctx.node : null;
    const declaresId = node?.functionType === 'FunctionDeclaration' || node?.classType === 'ClassDeclaration'
      || (type === NodeKind.TsFunction && ctx.parent?.typeId !== NodeKind.TsMethodDefinition) || type === NodeKind.TsEnumDeclaration;
    if (declaresId) { declarePattern(node.id, scope); }
    if (opens) {
      scope = { parent: scope, bindings: new Map(), function: isFunction || type === NodeKind.Program || type === NodeKind.StaticBlock, index: state.evaluator.scopeTable.length };
      state.evaluator.scopeTable.push(scope);
      state.opened[ctx.nodeId] = 1;
    }
    if (isFunction) {
      declarePattern(node.id, scope);
      if (node.params) {
        for (const parameter of node.params.items) { declarePattern(parameter, scope); }
        declarePattern(node.params.rest, scope);
      }
    }
    if (type === NodeKind.Class && node.classType === 'ClassExpression') { declarePattern(node.id, scope); }
    if (type === NodeKind.CatchClause) { declarePattern(node.param, scope); }
    if (type === NodeKind.ImportDeclaration) {
      for (const specifier of node.specifiers) {
        declarePattern(specifier.local, scope);
        if (node.source.value === 'react-intl' && node.importKind !== 'Type' && specifier.importKind !== 'Type') {
          scope.bindings.get(specifier.local.name).imported = specifier.typeId === NodeKind.ImportNamespaceSpecifier
            ? '*' : specifier.imported?.name ?? specifier.imported?.value;
        }
      }
    }
    if (type === NodeKind.VariableDeclarator) {
      let target = scope;
      const kind = ctx.parent.kind;
      if (kind === 'Var') { while (!target.function) { target = target.parent; } }
      const pattern = node.id;
      declarePattern(pattern, target);
      if (pattern.typeId === NodeKind.BindingIdentifier) {
        const init = kind === 'Var' ? NONE : ctx.ast.ref(ctx.nodeId, Field.init);
        state.declarations.push({ binding: target.bindings.get(pattern.name), init: init === NONE ? null : init });
      }
    }
    state.scope = scope;
  },
  // Leave uses only the numeric identity, so an untouched node is never
  // materialized.
  leave(ctx) {
    const state = ctx.state;
    if (state.opened[ctx.nodeId] !== 0) { state.scope = state.scope.parent; }
  },
});

export class Evaluator extends EvaluatorBase {
  // Keep the evaluator layout alive without retaining a program or its buffer.
  static #shape = new this(emptyEvaluator);
  // Dense node IDs make typed arrays cheaper than Set/Map on the scope path.
  scopeIds = null;
  scopeTable = [];
  opened = null;

  constructor(program) {
    super();
    if (program === emptyEvaluator) { return; }
    this.ast = program.ast;
    const nodeCount = program.ast.totalNodeCount;
    this.scopeIds = new Uint32Array(nodeCount);
    this.opened = new Uint8Array(nodeCount);
    const state = { evaluator: this, scope: undefined, opened: this.opened, declarations: [] };
    scopeWalker.walk(program, state);
    for (const { binding, init } of state.declarations) { if (init !== null) { this.values.set(binding, init); } }
  }

  binding(node) {
    const name = node.name;
    const index = this.scopeIds[node.nodeId];
    if (index === 0) { return; }
    let scope = this.scopeTable[index - 1];
    while (scope) {
      if (scope.bindings.has(name)) { return scope.bindings.get(name); }
      scope = scope.parent;
    }
  }
}
