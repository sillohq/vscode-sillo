import * as vscode from 'vscode';

/**
 * Support for Pydantic models used as `request_model=`/`response_model=` on
 * a route decorator: completing a model name when typing one of those
 * kwargs, and jumping from `ctx.validated_data` to the request model that
 * decorator declared.
 *
 * Regex-based, like scan.ts — good enough for the common one-line-decorator,
 * one-file-model case, not a Python parser.
 */

const MODEL_CLASS = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/;
const MODEL_KWARG = /\b(?:request_model|response_model)\s*=\s*$/;
const ROUTE_DECORATOR_LINE = /^\s*@\w+\.(get|post|put|patch|delete)\(/;
const REQUEST_MODEL_KWARG = /\brequest_model\s*=\s*(\w+)/;
const HANDLER_DEF = /^\s*(?:async\s+)?def\s+\w+\s*\(/;
const CTX_VALIDATED_DATA = /\bctx\.validated_data\b/;

interface ModelClass {
  name: string;
  line: number;
}

function findModelClasses(document: vscode.TextDocument): ModelClass[] {
  const models: ModelClass[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    const match = MODEL_CLASS.exec(document.lineAt(i).text);
    if (match && /\bBaseModel\b/.test(match[2])) {
      models.push({ name: match[1], line: i });
    }
  }
  return models;
}

export class ModelKwargCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (!MODEL_KWARG.test(linePrefix)) return undefined;

    return findModelClasses(document).map((model) => {
      const item = new vscode.CompletionItem(model.name, vscode.CompletionItemKind.Class);
      item.detail = `class ${model.name}(BaseModel)`;
      return item;
    });
  }
}

/** Walks up from `line` to the nearest route decorator's `request_model=`, if any. */
function findRequestModelAbove(document: vscode.TextDocument, line: number): string | undefined {
  for (let i = line; i >= 0; i--) {
    const text = document.lineAt(i).text;
    if (ROUTE_DECORATOR_LINE.test(text)) {
      const match = REQUEST_MODEL_KWARG.exec(text);
      return match?.[1];
    }
    // A blank line or another handler's body means we've walked past this
    // route's own decorator without finding one directly above the handler.
    if (i !== line && HANDLER_DEF.test(text)) return undefined;
  }
  return undefined;
}

export class ValidatedDataDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /validated_data/);
    if (!wordRange) return undefined;

    const linePrefix = document.lineAt(position.line).text.slice(0, wordRange.start.character);
    if (!/\bctx\.$/.test(linePrefix)) return undefined;
    if (!CTX_VALIDATED_DATA.test(document.lineAt(position.line).text)) return undefined;

    // Find the handler this line belongs to, then the decorator above it.
    let handlerLine: number | undefined;
    for (let i = position.line; i >= 0; i--) {
      if (HANDLER_DEF.test(document.lineAt(i).text)) {
        handlerLine = i;
        break;
      }
    }
    if (handlerLine === undefined) return undefined;

    const modelName = findRequestModelAbove(document, handlerLine - 1);
    if (!modelName) return undefined;

    const model = findModelClasses(document).find((m) => m.name === modelName);
    if (!model) return undefined;

    return new vscode.Location(document.uri, new vscode.Position(model.line, 0));
  }
}
