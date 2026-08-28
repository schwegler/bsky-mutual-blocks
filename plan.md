1.  **Analyze the Issue:**
    *   The user is reporting that checking for mutuals who block a supplied account, or mutuals that block each other, is not working correctly after recent performance optimizations (`8ccb3d7b63ca52e7ad51b9915808cb32b7121895`).
    *   The memory hints explain: `In AT Protocol, block records in 'app.bsky.graph.block' store subject DIDs rather than handles. Target handles must be resolved to canonical DIDs using resolveActor / getProfile before checking repository block records.`
    *   Currently, the `findMutualsBlockingTarget` function resolves the target account and checks against DID, Handle, and Input.
    *   However, the recent change (commit `58d2df6e657a5cd35b66924923b6c78f89c24fe5` fixing mutual block resolution) seems to have modified `fetchAllUserBlocks` or how `isBlocked` is calculated. It added checks where block targets from `fetchAllUserBlocks` are matched against handles. But the memory says `block records store subject DIDs rather than handles`. So, checking handles is pointless, and maybe it breaks things or doesn't match properly if a mutual blocks someone but we are matching by handle instead of DID.
    *   Wait, the issue is that it's *not* finding mutuals who block the supplied account.
    *   Let's check `findMutualsBlockingTarget`:
        ```typescript
        const targetIdentifiers = new Set<string>();
        targetIdentifiers.add(targetDid.trim().toLowerCase().replace(/^@/, ''));
        if (targetHandle) {
          targetIdentifiers.add(targetHandle.trim().toLowerCase().replace(/^@/, ''));
        }
        targetIdentifiers.add(targetInput.trim().toLowerCase().replace(/^@/, ''));
        ```
        And inside `findTopBlockersAmongMutuals`:
        ```typescript
        const mutualsMap = new Map<string, MutualProfile>();
        for (const m of mutuals) {
          mutualsMap.set(m.did.trim().toLowerCase().replace(/^@/, ''), m);
          if (m.handle) {
            mutualsMap.set(m.handle.trim().toLowerCase().replace(/^@/, ''), m);
          }
        }
        // ...
        const cleanSubject = blockedSubject.trim().toLowerCase().replace(/^@/, '');
        const matchedMutual = mutualsMap.get(cleanSubject);
        ```
        If the records store subject DIDs, they will be of the format `did:plc:...`.
        If we look at the block records from `test-resolveActor.ts`, we get errors because `listRecords` isn't supported on AppView for other users when authenticated, or it requires PDS auth, but the test mock sets them to `did:plc:m2` and also `subject: '@m2.bsky.social'`.
        Oh! Wait. `did`s are case-sensitive. DIDs usually look like `did:plc:ragtjsm2j2vmnmtekeeikstw` and they are lowercased by default, but standard DIDs should NOT be `.toLowerCase()`'d during matching if they are case-sensitive, though `.toLowerCase()` shouldn't break `did:plc:` since they are lower case anyway. But maybe `did:web:`?
        Actually, let's look at `fetchAllUserBlocks`:
        ```typescript
        const subject = (record.value as { subject?: string })?.subject;
        ```
        If `record.value.subject` is a DID, like `did:plc:rag...`.
        Then we `b.trim().toLowerCase().replace(/^@/, '')`.
        Wait, in `findMutualsBlockingTarget` and `findTopBlockersAmongMutuals`, did we lower-case the mutual DIDs?
        ```typescript
        targetIdentifiers.add(targetDid.trim().toLowerCase().replace(/^@/, ''));
        ```
        ```typescript
        mutualsMap.set(m.did.trim().toLowerCase().replace(/^@/, ''), m);
        ```
        So if a DID contains uppercase letters, it'll be lowercased. Do DIDs contain uppercase letters? Some DIDs, like `did:web:`, might, but `did:plc:` are base32 which might be uppercase? No, base32 in DIDs is lowercase.
        Wait, let's check `searchActorsTypeahead` or `resolveActor`. `resolveActor` returns `res.data.did`.

        Is there something wrong with how `targetIdentifiers` is built?
        ```typescript
        const targetIdentifiers = new Set<string>();
        targetIdentifiers.add(targetDid.trim().toLowerCase().replace(/^@/, ''));
        ```
        If `blockedSubject` is a DID from `listRecords`, it's not a handle. It's always a DID according to the memory: `In AT Protocol, block records in 'app.bsky.graph.block' store subject DIDs rather than handles. Target handles must be resolved to canonical DIDs using resolveActor / getProfile before checking repository block records.`
        Wait, the user says "not finding mutuals who block the supplied account ... Neither feature is working as expected".
        Look at `findTopBlockersAmongMutuals`:
        ```typescript
        const cleanSubject = blockedSubject.trim().toLowerCase().replace(/^@/, '');
        const matchedMutual = mutualsMap.get(cleanSubject);
        ```
        Wait! In `findMutualsBlockingTarget`, if they input a handle, we resolve it to `targetDid`, and we check if `blocks` contain `targetDid`. But wait, in `resolveActor`:
        ```typescript
        // Try agent.getProfile or agent.app.bsky.actor.getProfile
        try {
          const getProfileFn = agent.getProfile
            ? (actor: string) => agent.getProfile({ actor })
            : (actor: string) => agent.app.bsky.actor.getProfile({ actor });
          const res = await getProfileFn(cleanInput);
          return { did: res.data.did, profile: res.data };
        } catch {
          // Fallback to resolveHandle if getProfile fails
          const resolveHandleFn = agent.resolveHandle
            ? (handle: string) => agent.resolveHandle({ handle })
            : (handle: string) => agent.com.atproto.identity.resolveHandle({ handle });
          const res = await resolveHandleFn(cleanInput);
          return { did: res.data.did };
        }
        ```
        Wait, `findMutualsBlockingTarget` is finding mutuals that block `targetDid`. That seems fine.
        What if `cleanInput` in `resolveActor` is breaking? `agent.getProfile` is not on `Agent`? Wait, `agent.getProfile` is an AppView proxy method but `Agent` has it? Let's check `Agent` methods in `test-agent-methods.ts`. Yes, `agent.getProfile` is there.

        Wait, look at `fetchAllUserBlocks`:
        ```typescript
        const response = await api.listRecords({
          repo: repoDid,
          collection: 'app.bsky.graph.block',
          limit: 100,
          cursor
        });
        ```
        In recent changes to Bluesky API, `com.atproto.repo.listRecords` for `app.bsky.graph.block` may not return the `subject` DID properly?
        Wait, in `tests/bsky.test.ts`:
        ```typescript
        it('matches mutual when block record stores mutual handle instead of DID and handles empty handle', async () => {
          ...
          records: [{ value: { subject: '@m2.bsky.social' } }]
        ```
        This test says it matches when the block record stores a handle.
        However, the memory explicitly states:
        **"In AT Protocol, block records in 'app.bsky.graph.block' store subject DIDs rather than handles. Target handles must be resolved to canonical DIDs using resolveActor / getProfile before checking repository block records."**
        But wait! `findMutualsBlockingTarget` does resolve the handle to a DID.
        ```typescript
        const resolved = await resolveActor(agent, targetInput);
        targetDid = resolved.did;
        ```
        So if it *does* resolve to a DID, and block records store DIDs, why wouldn't it work?

        Let's look at `fetchAllUserBlocks`. It uses `com.atproto.repo.listRecords`. Is there a problem here?
        What does a `listRecords` response look like for a block record?
        According to `@atproto/api` types, `record.value` is an object.
        ```typescript
        const subject = (record.value as { subject?: string })?.subject;
        ```
        Wait. The memory says: `"In AT Protocol, block records in 'app.bsky.graph.block' store subject DIDs rather than handles. Target handles must be resolved to canonical DIDs using resolveActor / getProfile before checking repository block records."`
        Look at `findMutualsBlockingTarget`:
        ```typescript
        const blocks = await fetchAllUserBlocks(agent, mutual.did);
        const isBlocked = blocks.some((b) => {
          const cleanB = b.trim().toLowerCase().replace(/^@/, '');
          return targetIdentifiers.has(cleanB);
        });
        ```
        Wait! In `findTopBlockersAmongMutuals` we have:
        ```typescript
        for (const m of mutuals) {
          mutualsMap.set(m.did.trim().toLowerCase().replace(/^@/, ''), m);
          if (m.handle) {
            mutualsMap.set(m.handle.trim().toLowerCase().replace(/^@/, ''), m);
          }
        }
        ```
        Wait, why is it `.replace(/^@/, '')` on DIDs? And lowercasing? DIDs are case-sensitive in the AT protocol. For instance, `did:plc:...` is lower case, but `did:web:` can contain uppercase letters. Though, even if it's lowercase, `mutualsMap.set` sets it using lowercase. And we check lowercase. That should match.
        BUT wait! In AT Protocol, a block record is stored as:
        `record.value.subject` -> is this a string? Yes, `subject` is a DID string.
        Wait... no! `app.bsky.graph.block` record schema:
        ```json
        {
          "$type": "app.bsky.graph.block",
          "subject": "did:plc:...",
          "createdAt": "..."
        }
        ```
        Is it `record.value.subject`? Yes.
        Wait. Is it `targetIdentifiers.has(cleanB)`? If it does, `isBlocked` is true.

        Let's look closer at `targetIdentifiers`. It contains `targetDid`.
        If the user inputs a DID like `did:plc:123`, `resolveActor` sets `targetDid = 'did:plc:123'`.
        `targetIdentifiers` will have `'did:plc:123'`.
        `blocks` will have `'did:plc:123'`.
        It should match.
        Why did it break after `8ccb3d7b63ca52e7ad51b9915808cb32b7121895`?
        Wait, let's see what changed in `findMutualsBlockingTarget` or `findTopBlockersAmongMutuals` in that PR.
        Before, did it just use handles? No, it looks like it added `.replace(/^@/, '')` and `.toLowerCase()`.

        Wait, look at this:
        DIDs are NOT case-insensitive. If `resolveActor` returns a DID with mixed case (e.g., `did:web:MyDomain.com`), `.toLowerCase()` will break the matching if `fetchAllUserBlocks` returns the original mixed case DID from the block record? No, wait... wait, `fetchAllUserBlocks` returns what is in the block record. And we also `.toLowerCase()` that (`const cleanB = b.trim().toLowerCase().replace(/^@/, '');`). So it matches.

        Is there another issue?
        "Target handles must be resolved to canonical DIDs using resolveActor / getProfile before checking repository block records."

        Wait! Let's check `bsky.ts` `findTopBlockersAmongMutuals`!
        It maps over `mutuals`, and for each mutual it calls `fetchAllUserBlocks(agent, mutual.did)`.
        Then:
        ```typescript
        const blocks = await fetchAllUserBlocks(agent, mutual.did);
        for (const blockedSubject of blocks) {
          const cleanSubject = blockedSubject.trim().toLowerCase().replace(/^@/, '');
          const matchedMutual = mutualsMap.get(cleanSubject);
          ...
        }
        ```
        But what if `mutuals` only has handles, not DIDs?
        No, `mutuals` are `MutualProfile` which has `did`.

        Wait, `fetchAllUserBlocks(agent, mutual.did)` was added in the previous PR.
        Let's look at `fetchAllUserBlocks`.
        ```typescript
        const response = await api.listRecords({
          repo: repoDid,
          collection: 'app.bsky.graph.block',
          limit: 100,
          cursor
        });
        ```
        But wait! `com.atproto.repo.listRecords` ONLY returns the user's *own* records if the AppView or PDS allows it?
        If `api.listRecords` is hitting an AppView or PDS, does it allow fetching another user's blocks?
        Yes, `listRecords` is public. But wait, `listRecords` is paginated.
        Are block records public? Yes, block records are public in the repo.
        Wait, look at `com.atproto.repo.listRecords` in my `test-pds.ts`: it returned `AuthMissing` for `bsky.social`. It returned `MethodNotImplemented` for `public.api.bsky.app`.
        Wait!!!
        `public.api.bsky.app` (AppView) DOES NOT IMPLEMENT `com.atproto.repo.listRecords`!
        It threw `Method Not Implemented` in my test script `test-listRecords.ts`.
        ```
        XRPCError: Method Not Implemented
        ```
        Ah! The AppView does not support `com.atproto.repo.listRecords`!
        So `fetchAllUserBlocks` is failing for everyone!
        Wait, if it's failing, how is it handling errors?
        ```typescript
      } catch (err: any) {
        attempts++;
        const isRateLimit = err?.status === 429 || err?.message?.includes('Rate Limit');

        if (isRateLimit && attempts < maxRetries) {
          const waitMs = Math.pow(2, attempts) * 1000;
          console.warn(`[429] Rate limit on ${repoDid}. Retrying in ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          // If deactivated, deleted, private repo, or max retries exceeded, safely exit
          return blockedDids;
        }
      }
        ```
        If it gets `Method Not Implemented` (status 501), it just silently returns `blockedDids` (which is `[]`)!
        It returns an empty array for EVERY user!
        Because the AppView (`public.api.bsky.app`) doesn't support `listRecords`.

        Wait, if `com.atproto.repo.listRecords` doesn't work on the AppView, how do we get a user's blocks?
        In Bluesky, block records are available on the user's PDS. But resolving the PDS for every user is slow.
        Is there a way to get blocks via AppView?
        `agent.app.bsky.graph.getBlocks()` gets the *authenticated user's* blocks, not arbitrary mutuals' blocks.
        Wait, how to get another user's blocks?
        We need to fetch their repo blocks.
        We can use `com.atproto.repo.listRecords` but we have to send the request to their PDS, OR we can send it to the Relay (e.g., `bsky.network`). But wait, my test to `bsky.network` returned `Not Found` for `listRecords`? No, relay doesn't support XRPC for repos in the same way, maybe?
        Wait, I tested `listRecords` against `bsky.network` and got 404.
        I tested against `bsky.social` and got `401 AuthMissing`! Wait, `listRecords` requires authentication on the PDS now? No, `com.atproto.repo.listRecords` does not require auth, but my test used `new Agent('https://bsky.social')` and it failed with 401. Wait, let me check `test-pds.ts`:
        `const list = await agent.com.atproto.repo.listRecords({...});`
        Error: AuthMissing.

        Wait, `app.bsky.graph.getBlocks` requires auth.
        But how did it work *before* `8ccb3d7b63ca52e7ad51b9915808cb32b7121895`?
        The user says: "Ever since we added the features to make things faster (commits after 8ccb3d7b63ca52e7ad51b9915808cb32b7121895) it's not finding mutuals who block the supplied account"
        Wait, what did it do before?
        Let's look at `fetchAllUserBlocks` - it's calling `api.listRecords({ repo: repoDid, collection: 'app.bsky.graph.block' })`.
        If we look at `bsky.ts`:
        ```typescript
        const api = agent.com?.atproto?.repo
          ? agent.com.atproto.repo
          : agent.api?.com?.atproto?.repo
          ? agent.api.com.atproto.repo
          : null;
        ```
        If we are authenticated via `OAuthSession`, `agent` is an authenticated agent!
        If we are authenticated, `agent` is authenticated against our *own* PDS.
        If we send `listRecords` to our *own* PDS, asking for another user's `repo`, our PDS will return `InvalidRequest: Could not find repo: did:plc:...` because that repo is not hosted on our PDS! (Unless they happen to be on the same PDS, like `bsky.social`).
        Wait, my `test-getBlocks-2.ts` hit `bsky.social` for `did:plc:rag...` and got `Could not find repo`!
        So `listRecords` only works if we query the specific PDS that hosts the repo!

        Wait, how can we fetch records from arbitrary users?
        We could fetch them from the AppView? The AppView DOES NOT support `listRecords`.
        We could fetch them using `agent.app.bsky.graph.getList`? No, blocks are not lists.
        Actually, AppView provides `app.bsky.graph.getBlocks` to get blocks for the *logged in user*, but how do we see who another user blocks?
        You can't do it via AppView easily unless you use `app.bsky.graph.getFollows`/`getFollowers`. Wait, AppView proxy `com.atproto.repo.listRecords` doesn't exist.
        Is it `app.bsky.graph.block`? Yes, those are records.
        To get a user's records, we MUST query their PDS. Or use a public service that provides it.
        Wait, `https://public.api.bsky.app/xrpc/app.bsky.graph.getBlocks` is for the logged in user.
        But wait! How was it working before?
        If we look at the changes in PR #12:
        "Fix mutual block identification for handle and DID variations"
        Wait! The commit message says "Fix mutual block identification for handle and DID variations".
        Maybe the issue is just the matching logic, not `listRecords`?
        Wait, is it failing silently for EVERYONE, or is it just failing for some?
        Let's check if we can query the public API for block records.
        Actually, we can use the `getProfile` or `getProfiles` endpoint to check if we are blocked? No, we want to know if a mutual blocks *a specific target*.
        If we want to know if `m1` blocks `target`, can we use `getProfile`? No.
