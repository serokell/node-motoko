import mo from '../src/versions/moc';
import { Node, asNode, AST } from '../src/ast';

const actorSource = `
import { print } "mo:base/Debug";

actor Main {
    public query func test() : async Nat {
        123
    }
};
`;

describe('ast', () => {
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
        mo.loadPackage(require('../packages/latest/base.json'));
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

    test('parent property in typed AST with cache', async () => {
        mo.loadPackage(require('../packages/latest/base.json'));
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
        const [progs, cache] = file.parseMotokoTypedLsp(null);
        const node = asNode(progs.ast);
        expect(node).toBeTruthy();
        expect(cache).toBeTruthy();
        check(node!);

        const changedActorSource = actorSource.replace('123', '42');
        file.write(changedActorSource);
        const [progs2, cache2] = file.parseMotokoTypedLsp(cache);
        const node2 = asNode(progs2.ast);
        expect(node2).toBeTruthy();
        expect(cache2).toBeTruthy();
    });
});
