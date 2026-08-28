Wait, if it's the PR "Fix mutual block identification for handle and DID variations", let me see what it changed. Ah, `bsky.ts` was `new file mode` in that commit? Wait, it was a merge commit.
Let me get the diff for the merge commit:
`git diff 58d2df6e657a5cd35b66924923b6c78f89c24fe5^1 58d2df6e657a5cd35b66924923b6c78f89c24fe5 src/bsky.ts`
