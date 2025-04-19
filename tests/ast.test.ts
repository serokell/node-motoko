import mo from '../src/versions/moc';
import { AST, Node, asNode } from '../src/ast';
import { MotokoFile, Scope } from '../src/file';
import fs from 'fs';
import path from 'path';

const actorSource = `
import { print } "mo:base/Debug";

actor Main {
    public query func test() : async Nat {
        123
    }
};
`;

const badActorSource = `
import { print } "mo:base/Debug";

actor Main {

    let x = 1
    public query test() : async Nat {
        123
    }
};
`;

function loadFile(dirpath: string, filepath: string): MotokoFile {
    const root = path.join(__dirname, dirpath);
    const file = mo.file(filepath);
    file.write(fs.readFileSync(path.join(root, filepath), 'utf-8'));
    return file;
}

function loadTopAndBottom(): [MotokoFile, MotokoFile] {
    return [loadFile('cache', 'Top.mo'), loadFile('cache', 'Bottom.mo')];
}

function ignoreGeneratedScopeVar(ast: AST): AST {
    if (Array.isArray(ast)) {
        return ast.map(ignoreGeneratedScopeVar);
    }
    if (typeof ast === 'string') {
        if (/^\$__\d+$/.test(ast)) {
            return '$__ignored-scope-var';
        }
        return ast;
    }
    if (ast) {
        if (ast.args) {
            ast.args = ast.args.map(ignoreGeneratedScopeVar);
        }
        if (ast.typeRep) {
            ast.typeRep = ignoreGeneratedScopeVar(ast.typeRep) as Node;
        }
    }
    return ast;
}

describe('ast', () => {
    beforeAll(() => {
        mo.loadPackage(require('../packages/latest/base.json'));
    });

    test('parent property in expression', async () => {
        const ast = mo.parseMotoko('let x = 0; x');
        const args = ast.args!.filter(
            (arg) => arg && typeof arg === 'object' && !Array.isArray(arg),
        ) as Node[];
        expect(args).toHaveLength(2);
        args.forEach((node) => {
            expect(node.parent).toBe(ast);
        });
    });

    test('parent property in typed AST', async () => {
        const file = mo.file('AST.mo');
        file.write(actorSource);

        const check = (node: Node) => {
            for (const arg of node.args || []) {
                const argNode = asNode(arg);
                if (argNode) {
                    expect(argNode.parent).toBe(node);
                    check(argNode);
                }
            }
        };
        const node = asNode(file.parseMotokoTyped().ast);
        expect(node).toBeTruthy();
        check(node!);
    });

    test('unchanged file should have equal caches', async () => {
        const file = mo.file('AST.mo');
        file.write(actorSource);
        const [prog0, cache0] = file.parseMotokoTypedWithScopeCache(new Map<string, Scope>());
        expect(prog0.ast).toBeTruthy();
        expect(prog0.immediateImports.length).toEqual(1);
        expect(prog0.immediateImports[0]).toMatch(
            /\.node-motoko\/base\/moc-[0-9\.]+\/Debug\.mo/,
        );
        const keys0 = Array.from(cache0.keys());
        expect(keys0.length).toEqual(2);
        expect(keys0[0]).toMatch(
            /\.node-motoko\/base\/moc-[0-9\.]+\/Debug\.mo/,
        );
        expect(keys0[1]).toEqual('@prim');

        const [prog1, cache1] = file.parseMotokoTypedWithScopeCache(cache0);
        expect(cache1).toEqual(cache0);
        expect(ignoreGeneratedScopeVar(prog1.ast)).toStrictEqual(ignoreGeneratedScopeVar(prog0.ast));
        expect(prog1.immediateImports).toEqual(prog0.immediateImports);
    });

    test('deleting from cache has equal new cache', async () => {
        const file = mo.file('AST.mo');
        file.write(actorSource);
        const [prog0, cache0] = file.parseMotokoTypedWithScopeCache(new Map<string, Scope>());

        // Delete cache, ensure it works
        const cache0Clone = new Map<string, Scope>(cache0);
        cache0.delete('AST.mo');
        const [prog1, cache1] = file.parseMotokoTypedWithScopeCache(cache0);
        expect(cache1).toEqual(cache0Clone);
        expect(prog1.ast).toBeTruthy();
        expect(prog1.immediateImports).toEqual(prog0.immediateImports);
        expect(ignoreGeneratedScopeVar(prog1.ast)).toStrictEqual(ignoreGeneratedScopeVar(prog0.ast));
    });

    test('changed file should have different caches', async () => {
        const file = mo.file('AST.mo');
        file.write(actorSource);
        const [prog0, cache0] = file.parseMotokoTypedWithScopeCache(new Map<string, Scope>());

        // Remove import, ensure caches are different
        const actorSource1 = actorSource.substring(1 + actorSource.indexOf(';'));
        file.write(actorSource1);

        const cache0Clone = new Map<string, Scope>(cache0);
        cache0.clear();
        const [prog1, cache1] = file.parseMotokoTypedWithScopeCache(cache0);
        expect(Array.from(cache1.keys())).toEqual([]);
        expect(prog1.ast).toBeTruthy();
        expect(prog1.immediateImports).toEqual([]);
        expect(cache1).not.toStrictEqual(cache0Clone);
        expect(prog1.ast).not.toStrictEqual(prog0.ast);
    });

    test('invalidating an unchanged reference without invalidating the file should be invalid', async () => {
        const [top, _bottom] = loadTopAndBottom();

        const [prog0, cache0] = top.parseMotokoTypedWithScopeCache(new Map<string, Scope>());
        expect(prog0.ast).toBeTruthy();
        expect(prog0.immediateImports).toEqual(['Bottom.mo']);
        expect(Array.from(cache0.keys())).toEqual(['Bottom.mo']);

        // Remove bottom and ensure cache is NOT valid (because Top is
        // invalidated)
        const cache0Clone = new Map<string, Scope>(cache0);
        cache0.delete('Bottom.mo');
        const [prog1, cache1] = top.parseMotokoTypedWithScopeCache(cache0);
        expect(cache1).toStrictEqual(cache0Clone);
        expect(Array.from(cache1.keys())).toEqual(['Bottom.mo']);
        expect(prog1.ast).toBeTruthy();
        expect(prog1.immediateImports).toEqual(prog0.immediateImports);
        expect(ignoreGeneratedScopeVar(prog1.ast)).toStrictEqual(ignoreGeneratedScopeVar(prog0.ast));
    });

    test('invalidating an unchanged file and reference should yield the same scope', async () => {
        const [top, _bottom] = loadTopAndBottom();

        // Remove top and bottom and ensure cache is valid
        const [prog0, cache0] = top.parseMotokoTypedWithScopeCache(new Map<string, Scope>());
        const cache0Clone = new Map<string, Scope>(cache0);
        cache0.delete('Bottom.mo');
        cache0.delete('Top.mo');
        const [prog1, cache1] = top.parseMotokoTypedWithScopeCache(cache0);
        expect(cache1).toStrictEqual(cache0Clone);
        expect(Array.from(cache1.keys())).toEqual(['Bottom.mo']);
        expect(prog1.ast).toBeTruthy();
        expect(prog1.immediateImports).toEqual(prog0.immediateImports);
        expect(ignoreGeneratedScopeVar(prog1.ast)).toStrictEqual(ignoreGeneratedScopeVar(prog0.ast));
    });

    test('load bottom after top should work', async () => {
        const [top, bottom] = loadTopAndBottom();

        const [_progTop, cacheTop] = top.parseMotokoTypedWithScopeCache(new Map<string, Scope>());
        const [progBottom, cacheBottom] = bottom.parseMotokoTypedWithScopeCache(cacheTop);
        expect(Array.from(cacheBottom.keys())).toEqual(['Bottom.mo']);
        expect(cacheBottom.get('Top.mo')).toStrictEqual(cacheTop.get('Top.mo'));
        expect(cacheBottom.get('Bottom.mo')).toStrictEqual(cacheTop.get('Bottom.mo'));
        expect(progBottom.ast).toBeTruthy();
        expect(progBottom.immediateImports).toEqual([]);
    });

    test('load top after bottom should work', async () => {
        const [top, bottom] = loadTopAndBottom();

        const [progBottom, cacheBottom] = bottom.parseMotokoTypedWithScopeCache(new Map<string, Scope>());
        expect(Array.from(cacheBottom.keys())).toEqual([]);
        expect(progBottom.ast).toBeTruthy();
        expect(progBottom.immediateImports).toEqual([]);

        const [progTop, cacheTop] = top.parseMotokoTypedWithScopeCache(cacheBottom);
        expect(Array.from(cacheTop.keys())).toEqual(['Bottom.mo']);
        expect(cacheTop.get('Bottom.mo')).not.toStrictEqual(cacheBottom.get('Bottom.mo'));
        expect(progTop.ast).toBeTruthy();
        expect(progTop.immediateImports).toEqual(['Bottom.mo']);
    });

    test('parseMotoko with error recovery', async () => {
        const ast1 = mo.parseMotoko('let x = 1 + 2 let y = 2', /*enableRecovery=*/true);
        expect(asNode(ast1.args![0])!.name).toBe("LetD");
        expect(asNode(ast1.args![1])!.name).toBe("LetD");

        const ast2 = mo.parseMotoko('let x = 1 + ', /*enableRecovery=*/true);
        expect(asNode(ast2.args![0])!.name).toBe("LetD");
    });

    // TODO: parseMotokoTypedWithScopeCache has API of error recovery, but still drop the value
    // test('parseMotokoTypedWithScopeCache with error recovery', async () => {
    //    const file = mo.file('AST.mo');
    //    file.write(badActorSource);
    //    let [prog0, cache0] = file.parseMotokoTypedWithScopeCache(new Map<string, Scope>(), /*enableRecovery=*/true);
    // });
});
