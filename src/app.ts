import type { Agent, AppBskyActorDefs } from '@atproto/api';
import { fetchAllMutuals, getErrorReasonMessage, resolveActor, searchActorsTypeahead, MutualProfile } from './bsky';
import { clearBlockCache, clearCircleCache, readCircle, saveCircle, scanCircle, resultRows, Mode, Snapshot, ResultRow } from './scan';
import { avatar, describeError, element, person, profileLink, createScopeElement } from './dom';

export interface Services {
  initOAuth: () => Promise<{ session: { sub: string } | null; agent: Agent | null }>;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const modes: Record<Mode, { title: string; intro: string; button: string }> = {
  lookup: { title: 'A clearer view of your circle.', intro: 'Find accounts in the signed-in account’s mutual circle whose public direct block records name the lookup subject. Mutuals follow the signed-in account and are followed back; the lookup subject’s mutuals are not fetched.', button: 'Check account' },
  sent: { title: 'Blocks sent, within your circle.', intro: 'Rank accounts in the signed-in account’s mutual circle by how many other accounts in that same circle their direct block records name. Direction: row account → other mutuals.', button: 'Scan blocks sent' },
  received: { title: 'Blocks received, within your circle.', intro: 'Rank accounts in the signed-in account’s mutual circle by how many other accounts in that same circle have direct block records naming them. Direction: other mutuals → row account.', button: 'Scan blocks received' }
};

/** One controller owns the active request, frozen target and result snapshot. No remote values enter HTML templates. */
export function createApp(services: Services) {
  const main = document.querySelector<HTMLElement>('#main')!;
  const identity = document.querySelector<HTMLElement>('#identity')!;
  const dialog = document.querySelector<HTMLDialogElement>('#modal')!;
  const dialogContent = document.querySelector<HTMLElement>('#modal-content')!;
  const announcement = document.querySelector<HTMLElement>('#announcement')!;
  let agent: Agent | null = null;
  let userDid = '';
  let profile: MutualProfile | null = null;
  let mode: Mode = 'lookup';
  let snapshot: Snapshot | null = null;
  let active: AbortController | null = null;
  let targetValue = '';
  let filter = '';
  let sort = 'count';
  let suggestionVersion = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let authBusy = false;
  let opener: HTMLElement | null = null;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
  const announce = (message: string) => { announcement.textContent = message; };
  const current = (controller: AbortController) => active === controller && !controller.signal.aborted;
  const invalidateSuggestions = () => { suggestionVersion++; clearTimeout(debounce); };
  const focusMain = () => main.focus({ preventScroll: true });

  function navigation() {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
      button.setAttribute('aria-current', button.dataset.mode === mode ? 'page' : 'false');
      button.disabled = !agent || !!active;
    });
  }
  function showIdentity() {
    identity.replaceChildren();
    const node = element('div', 'identity');
    const info = element('span', '', profile!.displayName || profile!.handle);
    info.append(element('small', '', '@' + profile!.handle));
    const button = element('button', 'text-button', 'Sign out');
    button.type = 'button';
    button.onclick = () => { void logout(button); };
    node.append(avatar(profile!), info, button);
    identity.append(node);
  }
  function login(message = '') {
    invalidateSuggestions();
    document.body.classList.add('signed-out');
    identity.replaceChildren();
    main.innerHTML = '<div class="welcome"><img class="hitch-mascot" src="/assets/brand/hitch.png" alt="" width="112" height="144" decoding="async"><h1>A clearer view<br>of your circle.</h1><p class="intro">Explore public direct block records among your Bluesky mutuals, with the scope and limits in plain sight.</p><div class="welcome-grid"><div><h2>Three ways to look.</h2><p>Check an account, or explore blocks sent and received within your mutual circle.</p><div class="flow-key"><b>01</b> Connect with Bluesky OAuth</div><div class="flow-key"><b>02</b> Find accounts you follow who follow you back</div><div class="flow-key"><b>03</b> Check direct records, with coverage notes</div></div><form class="auth-form" novalidate><h2>Start with your account.</h2><p>You’ll continue to your account provider to sign in. Your password belongs there.</p><label for="login-handle">Your Bluesky handle or DID</label><input id="login-handle" placeholder="you.bsky.social" autocomplete="username" spellcheck="false" aria-describedby="login-note login-error" required><p class="error-text" id="login-error" role="alert"></p><button class="primary" type="submit">Continue with Bluesky <span aria-hidden="true">→</span></button><p class="form-note" id="login-note">Your browser contacts Bluesky and account data servers. Public block lists may be stored in this browser and reused for up to 24 hours.</p><button type="button" class="text-button" id="login-privacy">Data sources & browser storage →</button></form></div><div class="privacy-strip"><span>No app password required</span><span>Browser-side analysis</span><span>Public direct records only</span></div></div>';
    q('.welcome').append(createScopeElement());
    q('#login-error').textContent = message;
    q('#login-privacy').onclick = showData;
    q<HTMLInputElement>('#login-handle').oninput = () => { q('#login-handle').removeAttribute('aria-invalid'); q('#login-error').textContent = ''; };
    q<HTMLFormElement>('.auth-form').onsubmit = async event => {
      event.preventDefault();
      if (authBusy) return;
      const input = q<HTMLInputElement>('#login-handle');
      const handle = input.value.trim().replace(/^@/, '');
      if (!validActor(handle)) { q('#login-error').textContent = 'Enter a full Bluesky handle or DID.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      authBusy = true;
      input.disabled = true;
      q<HTMLButtonElement>('.primary').disabled = true;
      q('#login-error').textContent = '';
      announce('Continuing to your account provider.');
      try { await services.signIn(handle); }
      catch (error) { q('#login-error').textContent = 'Could not start sign-in. ' + describeError(error); }
      finally { authBusy = false; input.disabled = false; q<HTMLButtonElement>('.primary').disabled = false; }
    };
    navigation();
  }
  function shell() {
    invalidateSuggestions();
    document.body.classList.remove('signed-out');
    main.innerHTML = '<h1></h1><p class="intro"></p><form class="tool-form" novalidate></form><div id="content"></div>';
    q('h1').textContent = modes[mode].title;
    q('.intro').textContent = modes[mode].intro;
    const form = q<HTMLFormElement>('.tool-form');
    if (mode === 'lookup') {
      form.innerHTML = '<label for="target">Account to check (block subject)</label><div class="form-line"><div class="input-wrap"><input id="target" placeholder="Handle or DID" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="suggestions" aria-autocomplete="list" aria-describedby="target-note target-error"><div id="suggestions" class="suggestions" role="listbox" aria-label="Account suggestions" hidden></div><p id="target-error" class="error-text" role="alert"></p></div><button class="primary" type="submit">Check account <span aria-hidden="true">→</span></button></div><p class="form-note" id="target-note">Enter one Bluesky handle or DID. Results show which mutuals of the signed-in account have direct block records naming this subject.</p>';
      q<HTMLInputElement>('#target').value = targetValue;
      autocomplete();
    } else {
      const button = element('button', 'primary', modes[mode].button + ' →');
      button.type = 'submit';
      form.append(button, element('p', 'form-note', 'The circle contains accounts that follow the signed-in account and are followed back. Counts stay within that circle; this is not a network-wide ranking.'));
    }
    form.onsubmit = event => { event.preventDefault(); if (!active) void run(); };
    navigation();
  }
  function ready() {
    shell();
    q('#content').innerHTML = '<div class="ready section-rule"><div><span class="eyebrow">YOUR CIRCLE, IN CONTEXT</span><h2 style="margin-top:14px">A relationship is not a reason.</h2><p>We look for direct block records, not explanations. Read the result as a snapshot of available data.</p></div><div><div class="flow-key"><b>01</b> Choose an account or circle view</div><div class="flow-key"><b>02</b> Discover your mutual circle</div><div class="flow-key"><b>03</b> Read available public records</div></div></div>';
    q('#content').append(createScopeElement());
  }
  function busy(controller: AbortController, title: string, description: string, processed?: number, total?: number) {
    if (!current(controller)) return;
    q<HTMLButtonElement>('.tool-form button.primary').disabled = true;
    if (mode === 'lookup') q<HTMLInputElement>('#target').disabled = true;
    q('#content').setAttribute('aria-busy', 'true');
    const loading = element('section', 'loading');
    const heading = element('div', 'loading-head');
    const copy = element('div');
    copy.append(element('h2', '', title), element('p', '', description));
    const cancel = element('button', 'secondary', 'Cancel scan');
    cancel.onclick = cancelScan;
    heading.append(copy, cancel);
    const progress = element('progress');
    progress.setAttribute('aria-label', 'Mutual accounts processed');
    if (total && processed !== undefined) { progress.max = total; progress.value = processed; }
    loading.append(heading, progress, element('p', 'form-note', 'A processed account may still be incomplete. Data sources can respond at different times.'));
    const content = q('#content');
    content.replaceChildren(loading);
    content.append(createScopeElement());
    if (processed === undefined) announce(title);
    navigation();
  }
  function cancelScan() {
    active?.abort(); active = null;
    if (snapshot) renderResults(); else ready();
    const note = element('p', 'cancel-note', 'Scan cancelled. Any result shown below is the previous snapshot.');
    main.querySelector('#content')!.prepend(note);
    announce('Scan cancelled.'); focusMain();
  }
  async function run(kind: 'new' | 'retry' | 'refresh' = 'new') {
    const old = kind === 'retry' ? snapshot : null;
    let entered = targetValue;
    if (mode === 'lookup' && !old) {
      entered = q<HTMLInputElement>('#target').value.trim().replace(/^@/, '');
      if (!validActor(entered)) { q('#target-error').textContent = 'Use a full Bluesky handle or DID.'; q('#target').setAttribute('aria-invalid', 'true'); q('#target').focus(); return; }
      targetValue = entered;
    }
    invalidateSuggestions();
    q('#suggestions')?.setAttribute('hidden', '');
    const controller = new AbortController(); active = controller;
    // Disable actions before any asynchronous preparation starts.
    busy(controller, 'Preparing your circle…', 'Checking the account and mutual-follower snapshot.');
    try {
      let target = old?.target;
      if (mode === 'lookup' && !target) {
        busy(controller, 'Resolving the account…', 'Matching the handle or DID to its canonical identifier.');
        const resolved = await resolveActor(agent!, entered);
        controller.signal.throwIfAborted();
        target = { did: resolved.did, handle: resolved.profile?.handle };
      }
      const cached = kind === 'refresh' ? null : readCircle(userDid);
      let circle = old ? { mutuals: old.mutuals, fetchedAt: old.circleFetchedAt } : cached;
      if (!circle) {
        busy(controller, 'Finding your mutuals…', 'Reading accounts you follow and checking who follows you back.');
        const mutuals = await fetchAllMutuals(agent!, userDid, count => busy(controller, 'Finding your mutuals…', count + ' mutual followers found so far.'), controller.signal);
        controller.signal.throwIfAborted();
        circle = { mutuals, fetchedAt: Date.now() }; saveCircle(userDid, circle);
      }
      if (!circle.mutuals.length) {
        snapshot = null; active = null; shell();
        showEmpty('No mutual followers found.', 'No accounts in the returned follow list were marked as following you back. Refresh the circle if you expected mutuals here.', () => { void run('refresh'); }, 'Refresh mutual circle');
        announce('No mutual followers found in the returned circle.'); return;
      }
      const next = await scanCircle(agent!, { mode, target, mutuals: circle.mutuals, circleFetchedAt: circle.fetchedAt }, {
        signal: controller.signal, forceRefresh: kind !== 'new', previous: old ?? undefined,
        onProgress: (processed, total) => busy(controller, 'Checking public records…', processed + ' of ' + total + ' accounts processed.', processed, total)
      });
      if (!current(controller)) return;
      snapshot = next; active = null; filter = ''; sort = 'count'; renderResults();
      const incomplete = next.observations.filter(o => !o.isComplete).length;
      announce(incomplete ? 'Scan finished with partial coverage. Incomplete accounts: ' + incomplete + '.' : 'Scan finished. All accounts in this circle were processed; direct records only.');
      focusMain();
    } catch (error) {
      if (!current(controller)) return;
      active = null; shell();
      const status = (error as { status?: number })?.status;
      const expired = status === 401 || status === 403;
      showEmpty(expired ? 'Your session needs a fresh start.' : 'The scan could not be completed.', expired ? 'Reconnect with Bluesky, then start a new scan.' : describeError(error) + ' No new result was published. This does not mean no records exist.', () => { if (expired) { agent = null; profile = null; snapshot = null; login(); } else void run(kind); }, expired ? 'Reconnect with Bluesky' : 'Try again');
      announce(expired ? 'Reconnect with Bluesky to continue.' : 'Scan failed. No new result was published.'); focusMain();
    }
  }
  function showEmpty(title: string, message: string, action: () => void, label: string) {
    const section = element('section', 'empty');
    section.append(element('h2', '', title), element('p', '', message));
    const button = element('button', 'secondary', label); button.onclick = action;
    section.append(button);
    q('#content').replaceChildren(section);
    q('#content').append(createScopeElement());
  }
  function renderResults() {
    shell();
    const data = snapshot!;
    const rows = resultRows(data);
    const incomplete = data.observations.filter(o => !o.isComplete);
    const cached = data.observations.filter(o => o.source === 'cache');
    const section = element('section', 'section-rule'); section.setAttribute('aria-label', 'Scan results');
    const head = element('div', 'result-head'); const title = element('div');
    title.append(element('h2', '', mode === 'lookup' ? rows.length ? rows.length + (rows.length === 1 ? ' mutual with a direct block record' : ' mutuals with direct block records') : 'No matching direct block records' : 'Blocks ' + (mode === 'sent' ? 'sent by' : 'received by') + ' your mutuals'));
    title.append(element('p', 'result-context', mode === 'lookup' ? 'Naming ' + (data.target!.handle ? '@' + data.target!.handle : data.target!.did) : 'Ranked by records observed within your mutual circle'));
    const meta = element('div', 'scan-meta');
    meta.append(element('span', '', data.mutuals.length + ' mutuals in this snapshot'), element('span', '', 'Circle fetched ' + new Date(data.circleFetchedAt).toLocaleString()));
    head.append(title, meta); section.append(head);
    const coverage = element('div', 'coverage');
    for (const [value, label] of [[data.observations.length - incomplete.length + ' / ' + data.mutuals.length, 'fully checked'], [String(incomplete.length), 'incomplete'], [String(cached.length), 'cached block lists']]) {
      const item = element('div'); item.append(element('strong', '', value), element('span', '', label)); coverage.append(item);
    }
    section.append(coverage);
    if (incomplete.length) {
      const warning = element('div', 'notice'); const content = element('div');
      content.append(element('strong', '', incomplete.length + ' of ' + data.mutuals.length + ' mutuals could not be fully checked.'), element('p', '', 'Findings are limited to available records. ' + (mode === 'lookup' ? 'Missing matches cannot rule out a direct block.' : 'Counts are lower bounds; ordering may change.')));
      const details = element('details'); details.append(element('summary', '', 'View incomplete accounts')); const list = element('ul', 'warning-list');
      for (const item of incomplete) list.append(element('li', '', '@' + item.moot.handle + ' — ' + getErrorReasonMessage(item.errorReason) + '; ' + item.blockedDids.length + ' records read.'));
      details.append(list); content.append(details);
      const retry = element('button', 'secondary', 'Retry incomplete'); retry.onclick = () => { void run('retry'); };
      const symbol = element('span', 'symbol', '△'); symbol.setAttribute('aria-hidden', 'true'); warning.append(symbol, content, retry); section.append(warning);
    }
    if (cached.length) {
      const notice = element('div', 'notice'); const copy = element('div');
      const oldest = Math.min(...cached.map(o => o.fetchedAt));
      copy.append(element('strong', '', 'This result includes cached block lists.'), element('p', '', 'Oldest cached list fetched ' + new Date(oldest).toLocaleString() + '. Successful lists may be reused for up to 24 hours. Refresh to request records again.'));
      notice.append(copy); section.append(notice);
    }
    const actions = element('div', 'scan-actions');
    const refresh = element('button', 'secondary', 'Refresh circle & records'); refresh.onclick = () => { void run('refresh'); };
    const notes = element('button', 'text-button', 'Data sources & browser storage →'); notes.onclick = showData;
    actions.append(refresh, notes); section.append(actions);
    if (!rows.length) {
      const empty = element('div', 'empty'); empty.append(element('h3', '', incomplete.length ? 'Nothing found in the records available.' : 'Nothing matched in this snapshot.'), element('p', '', incomplete.length ? 'Some accounts could not be fully checked. A missing result cannot rule out a direct block record.' : 'No matching direct records were returned for this circle. List-based blocks and later changes remain outside this view.'));
      section.append(empty);
    } else {
      const toolbar = element('div', 'toolbar'); const input = element('input'); input.type = 'search'; input.placeholder = 'Filter accounts…'; input.setAttribute('aria-label', 'Filter result accounts'); input.value = filter;
      const select = element('select'); select.setAttribute('aria-label', 'Sort results');
      for (const [value, label] of [['count', mode === 'lookup' ? 'Original order' : 'Most records first'], ['name', 'Name A–Z']]) { const option = element('option', '', label); option.value = value; select.append(option); }
      select.value = sort;
      input.oninput = () => { filter = input.value; drawRows(); }; select.onchange = () => { sort = select.value; drawRows(); };
      toolbar.append(input, select); section.append(toolbar);
      const labels = element('div', 'list-labels'); labels.setAttribute('aria-hidden', 'true'); labels.append(element('span', '', 'ACCOUNT'), element('span', '', mode === 'lookup' ? 'DIRECT RECORD DIRECTION' : 'WITHIN THIS CIRCLE'), element('span', '', 'DETAILS')); section.append(labels, element('div', 'records')); 
    }
    section.append(createScopeElement());
    const times = data.observations.map(o => o.fetchedAt);
    section.append(element('p', '', 'Block list observations: ' + new Date(Math.min(...times)).toLocaleString() + ' – ' + new Date(Math.max(...times)).toLocaleString() + '. A retry replaces the retried accounts’ observations; sources need not share one observation time. Times reflect fetch attempts or cached snapshots, not record creation, and use your browser’s local timezone.'));
    q('#content').replaceChildren(section);
    q('#content').setAttribute('aria-busy', 'false');
    if (rows.length) drawRows();
  }
  function drawRows() {
    const container = q('.records'); container.replaceChildren();
    const rows = resultRows(snapshot!).filter(row => (row.account.handle + ' ' + (row.account.displayName || '')).toLowerCase().includes(filter.toLowerCase()));
    if (sort === 'name') rows.sort((a, b) => (a.account.displayName || a.account.handle).localeCompare(b.account.displayName || b.account.handle));
    if (!rows.length) {
      const empty = element('div', 'empty'); empty.append(element('h3', '', 'No accounts match that filter.'));
      const clear = element('button', 'secondary', 'Clear filter'); clear.onclick = () => { filter = ''; q<HTMLInputElement>('.toolbar input').value = ''; drawRows(); q('.toolbar input').focus(); }; empty.append(clear); container.append(empty); return;
    }
    for (const row of rows) container.append(record(row));
  }
  function record(row: ResultRow) {
    const details = element('details', 'record'); const summary = element('summary');
    const partial = snapshot!.observations.some(o => !o.isComplete);
    const direction = mode === 'lookup' ? 'Blocks ' + (snapshot!.target!.handle ? '@' + snapshot!.target!.handle : snapshot!.target!.did) : (partial ? 'At least ' : '') + row.count + (mode === 'sent' ? ' mutual' + (row.count === 1 ? '' : 's') + ' blocked' : ' mutual' + (row.count === 1 ? '' : 's') + ' blocking this account');
    const arrow = element('span', 'row-action');
    arrow.innerHTML = 'View details <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3 10h13m-5-5 5 5-5 5"/></svg>';
    summary.append(person(row.account, true), element('span', 'direction', direction), arrow);
    const body = element('div', 'record-body');
    if (mode === 'lookup') {
      body.append(element('p', '', 'Direction: @' + row.account.handle + ' → ' + snapshot!.target!.did), element('p', '', 'A direct public record names the resolved target. It does not explain intent, current app behavior or a block in the reverse direction.'));
    } else {
      body.append(element('p', '', mode === 'sent' ? 'Direct record subjects — this account → listed accounts.' : 'Direct record authors — listed accounts → this account.'));
      for (const related of row.related) { const item = element('div', 'detail-person'); item.append(person(related, true), profileLink(related)); body.append(item); }
    }
    body.append(element('p', '', 'Collection: app.bsky.graph.block. Direct records only; not a cryptographic verification of repository contents.'), profileLink(row.account));
    details.append(summary, body); return details;
  }
  function autocomplete() {
    const input = q<HTMLInputElement>('#target'); const list = q('#suggestions');
    let actors: AppBskyActorDefs.ProfileViewBasic[] = []; let selected = -1;
    let gesture: { id: number; x: number; y: number; moved: boolean } | null = null;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); selected = -1; };
    const choose = (index: number) => { const actor = actors[index]; targetValue = actor.handle; input.value = actor.handle; invalidateSuggestions(); close(); input.focus(); };
    const highlight = () => {
      [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
      input.setAttribute('aria-activedescendant', 'actor-' + selected);
      list.children[selected]?.scrollIntoView?.({ block: 'nearest' });
    };
    input.oninput = () => {
      invalidateSuggestions(); close(); input.removeAttribute('aria-invalid'); q('#target-error').textContent = ''; targetValue = input.value;
      const query = input.value.trim(); if (query.length < 2 || query.startsWith('did:')) return;
      const version = suggestionVersion;
      debounce = setTimeout(async () => {
        try {
          const result = await searchActorsTypeahead(agent!, query);
          if (version !== suggestionVersion || !input.isConnected || active) return;
          actors = result; list.replaceChildren();
          actors.forEach((actor, index) => {
            let suppressClick = false;
            const option = element('div'); option.id = 'actor-' + index; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.append(person(actor));
            // Touch selection commits on release, before blur can dismiss the list.
            // Do not cancel touch down: native scrolling must still cancel a tap.
            option.onpointerdown = event => {
              if (event.pointerType !== 'touch') event.preventDefault();
              suppressClick = false;
              gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            };
            option.onpointermove = event => {
              if (gesture && event.pointerId === gesture.id && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) gesture.moved = true;
            };
            option.onpointerup = event => {
              if (!gesture || event.pointerId !== gesture.id) return;
              const moved = gesture.moved; gesture = null;
              suppressClick = moved;
              if (moved) close(); else { event.preventDefault(); choose(index); }
            };
            option.onpointercancel = () => { suppressClick = true; gesture = null; close(); };
            option.onpointerleave = () => { if (gesture) { suppressClick = true; gesture = null; close(); } };
            option.onclick = () => { if (!suppressClick) choose(index); }; list.append(option);
          });
          list.hidden = !actors.length; input.setAttribute('aria-expanded', String(actors.length > 0));
        } catch { if (version === suggestionVersion && input.isConnected) q('#target-error').textContent = 'Suggestions unavailable. You can still enter a full handle or DID.'; }
      }, 250);
    };
    input.onkeydown = event => {
      if (event.key === 'Escape') { invalidateSuggestions(); close(); }
      if (list.hidden || !actors.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = selected < 0 ? (event.key === 'ArrowDown' ? 0 : actors.length - 1) : (selected + (event.key === 'ArrowDown' ? 1 : -1) + actors.length) % actors.length; highlight(); }
      if (event.key === 'Enter' && selected >= 0) { event.preventDefault(); choose(selected); }
    };
    input.onblur = () => { invalidateSuggestions(); if (!gesture) close(); };
  }
  function openDialog(html: string) {
    opener = document.activeElement as HTMLElement;
    dialogContent.innerHTML = html;
    dialog.showModal(); document.querySelector<HTMLElement>('#close-dialog')!.focus();
  }
  function closeDialog() { dialog.close(); if (opener?.isConnected) opener.focus(); }
  function showData() {
    openDialog('<h2 id="dialog-title">What this view can tell you.</h2><p>The comparison circle belongs to the signed-in account, not the lookup subject. Mutuals are accounts the signed-in account follows that the authenticated follow response marks as following it back. We read public <code>app.bsky.graph.block</code> records from their personal data servers.</p><h3>Scope before certainty.</h3><p>Direct records only. List-based blocks, mutes, motives and network-wide relationships are outside scope. Partial scans can miss matches; records can change.</p><h3>Browser storage.</h3><p>Successful block lists are stored in IndexedDB and may be reused for up to 24 hours. Stored lists remain until overwritten or cleared. Mutual profiles are stored in this tab’s sessionStorage and reused for up to 15 minutes. Signing out clears the mutual cache, but stored block lists remain until cleared below. OAuth session persistence is managed by the AT Protocol client.</p><p>Your browser contacts identity, Bluesky and account data servers. Those services may log requests. The tool cannot promise anonymity or that no third party sees a lookup. OAuth currently uses the transitional atproto transition:generic scope; review the provider’s authorization screen.</p><div class="privacy-controls"><button class="secondary" id="clear-data" type="button">Clear cached scan data</button><p id="clear-status" role="status"></p></div>');
    const button = dialogContent.querySelector<HTMLButtonElement>('#clear-data')!;
    button.onclick = async () => {
      button.disabled = true;
      if (active) cancelScan();
      invalidateSuggestions();
      try { clearCircleCache(); await clearBlockCache(); snapshot = null; if (agent && !active) ready(); dialogContent.querySelector('#clear-status')!.textContent = 'Cached scan data cleared. Your OAuth session is unchanged.'; }
      catch { dialogContent.querySelector('#clear-status')!.textContent = 'Some cached data could not be cleared. Try again or use your browser’s site-data settings.'; }
      finally { button.disabled = false; }
    };
  }
  async function logout(button: HTMLButtonElement) {
    active?.abort(); active = null; invalidateSuggestions(); button.disabled = true;
    try { await services.signOut(); agent = null; userDid = ''; profile = null; snapshot = null; try { clearCircleCache(); } catch { /* sign-out must still complete */ } login(); announce('Signed out. Stored public block lists remain until cleared or overwritten.'); focusMain(); }
    catch { button.disabled = false; if (snapshot) renderResults(); else ready(); announce('Sign-out failed. Please try again.'); const note = element('p', 'error-notice', 'Sign-out failed. Please try again.'); main.prepend(note); }
  }
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.onclick = () => { if (!agent || active) return; mode = button.dataset.mode as Mode; snapshot = null; filter = ''; sort = 'count'; ready(); focusMain(); };
  });
  document.querySelector<HTMLElement>('#scope')!.onclick = showData;
  document.querySelector<HTMLElement>('#help')!.onclick = () => openDialog('<h2 id="dialog-title">A small window into the graph.</h2><p>Connect with Bluesky OAuth. Every view uses the signed-in account’s mutual circle: accounts it follows that follow it back.</p><h3>Account lookup</h3><p>Find members of the signed-in account’s circle with a direct block record naming the lookup subject. Direction: circle member → lookup subject. The lookup subject’s mutuals are not fetched.</p><h3>Blocks sent / received</h3><p>Explore directed records between mutuals, ranked by observed count. Open a row to inspect direction. These are not network-wide rankings.</p><h3>Keep the limits in view.</h3><p>Partial coverage and cached data affect results. Records do not explain intent. This independent tool is not affiliated with Bluesky.</p><p><a href="https://atproto.com/blog/block-implementation" target="_blank" rel="noopener noreferrer">AT Protocol: public block records ↗</a></p>');
  document.querySelector<HTMLElement>('#close-dialog')!.onclick = closeDialog;
  dialog.oncancel = () => { if (opener?.isConnected) opener.focus(); };

  async function start() {
    navigation(); main.innerHTML = '<h1>Moots</h1><p role="status">Restoring your Bluesky session…</p>';
    try {
      const auth = await services.initOAuth(); agent = auth.agent; userDid = auth.session?.sub || '';
      if (!agent || !userDid) { agent = null; login(); return; }
      profile = { did: userDid, handle: userDid };
      try { const result = await agent.getProfile({ actor: userDid }); profile = { ...result.data, did: userDid }; } catch { /* DID fallback */ }
      showIdentity(); ready();
    } catch { agent = null; login('Your session could not be restored. Sign in to try again.'); }
  }
  return { start, cancel: () => { active?.abort(); active = null; invalidateSuggestions(); } };
}

export function validActor(value: string): boolean {
  return /^did:(plc:[a-zA-Z0-9]+|web:[^\s/?#]+)$/.test(value) || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}
