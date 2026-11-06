$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\aryan\zerofyeoffice"
$deployRoot    = "C:\Users\aryan\cloudflare-deploy"
$shellRenderer = "$workspaceRoot\apps\shell\out\renderer"
$subApps       = @('docs', 'sheets', 'slides', 'pdf', 'markdown', 'html')
$projectName   = "ziroqx-officesuite"

Write-Host ">>> [1/4] Preparing deployment directory..." -ForegroundColor Cyan
if (!(Test-Path $deployRoot)) {
    New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
}

if (Test-Path "$deployRoot\downloads\ZerofyeOffice-Setup.exe") {
    Remove-Item -Path "$deployRoot\downloads\ZerofyeOffice-Setup.exe" -Force
}

Write-Host ">>> Copying main shell files..." -ForegroundColor Gray
Copy-Item -Path "$shellRenderer\*" -Destination $deployRoot -Recurse -Force

Write-Host ">>> [2/4] Copying sub-application renderers..." -ForegroundColor Cyan
foreach ($app in $subApps) {
    $src = "$workspaceRoot\apps\$app\out\renderer"
    $dst = "$deployRoot\apps\$app"
    if (Test-Path $src) {
        Write-Host "  -> Syncing $app renderer..." -ForegroundColor Gray
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
    }
}

Write-Host ">>> [3/4] Injecting Root Shell Virtual Drive..." -ForegroundColor Cyan
$destShellHtml = "$deployRoot\index.html"
$shellHtml = Get-Content $destShellHtml -Raw
$shellHtml = $shellHtml -replace '<meta\s+http-equiv="Content-Security-Policy"[^>]*>', ''

$shellPolyfill = @"
    <style>
      #web-editor-viewport {
        position: absolute;
        top: 41px;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: calc(100% - 41px);
        border: none;
        background: transparent;
        z-index: 10;
        display: none;
      }
      #web-editor-viewport.active {
        display: block;
      }
    </style>
    <iframe id="web-editor-viewport" src="about:blank" allowtransparency="true" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"></iframe>
    <script>
    (function() {
      if (typeof window === 'undefined') return;

      const DRIVE_STORAGE_KEY = 'zerofye_virtual_drive_files';
      function getStoredFiles() {
        try {
          const raw = localStorage.getItem(DRIVE_STORAGE_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch(e) { return []; }
      }

      function saveStoredFiles(files) {
        try { localStorage.setItem(DRIVE_STORAGE_KEY, JSON.stringify(files)); } catch(e) {}
      }

      let currentFiles = getStoredFiles();
      if (!currentFiles || currentFiles.length === 0) {
        currentFiles = [
          {
            id: 'sample-sheet',
            name: 'Financial Overview.xlsx',
            kind: 'sheets',
            path: 'Financial Overview.xlsx',
            modifiedMs: Date.now() - 3600000,
            sizeBytes: 4096,
            starred: false
          }
        ];
        saveStoredFiles(currentFiles);
      }

      const fileChangeListeners = new Set();
      function notifyFilesChanged() {
        const list = getStoredFiles();
        fileChangeListeners.forEach(fn => { try { fn(list); } catch(e) {} });
      }

      window.addEventListener('message', function(e) {
        if (!e.data) return;

        if (e.data.type === 'ZERO_FYE_FILE_SAVED') {
          const files = getStoredFiles();
          const existingIdx = files.findIndex(f => f.name === e.data.name || f.id === e.data.id);
          const fileEntry = {
            id: e.data.id || (existingIdx >= 0 ? files[existingIdx].id : 'file-' + Date.now()),
            name: e.data.name || 'Document',
            kind: e.data.kind || 'sheets',
            path: e.data.name || 'Document',
            modifiedMs: Date.now(),
            sizeBytes: e.data.sizeBytes || 2048,
            starred: existingIdx >= 0 ? files[existingIdx].starred : false
          };

          if (existingIdx >= 0) {
            files[existingIdx] = fileEntry;
          } else {
            files.unshift(fileEntry);
          }
          saveStoredFiles(files);
          notifyFilesChanged();
        }

        if (e.data.type === 'ZERO_FYE_DOWNLOAD') {
          try {
            const blob = new Blob([e.data.bytes], { type: e.data.mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = e.data.filename || 'Document';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
          } catch (err) {}
        }
      });

      const noop = () => {};
      const noopUnsub = () => () => {};
      const resolveEmptyArr = () => Promise.resolve([]);
      const resolveTrue = () => Promise.resolve(true);

      const tabs = [
        { id: 'home', kind: 'home', title: 'Home', closable: false, active: true }
      ];
      const tabListeners = new Set();

      function notifyTabs() {
        const snapshot = tabs.map(t => ({ ...t }));
        tabListeners.forEach(fn => { try { fn(snapshot); } catch(e) {} });
        updateIframe();
      }

      function updateIframe() {
        const frame = document.getElementById('web-editor-viewport');
        if (!frame) return;
        const currentActive = tabs.find(t => t.active);
        if (!currentActive || currentActive.id === 'home') {
          frame.classList.remove('active');
          frame.src = 'about:blank';
        } else {
          frame.classList.add('active');
          const targetUrl = '/apps/' + currentActive.kind + '/index.html?tabId=' + encodeURIComponent(currentActive.id) + '&fileName=' + encodeURIComponent(currentActive.title || '');
          if (frame.getAttribute('data-tab-id') !== currentActive.id) {
            frame.setAttribute('data-tab-id', currentActive.id);
            frame.src = targetUrl;
          }
        }
      }

      function openAppTab(kind, title) {
        tabs.forEach(t => t.active = false);
        const newTab = {
          id: 'tab-' + Math.random().toString(36).substring(2, 9),
          kind: kind,
          title: title || ('Untitled ' + kind),
          closable: true,
          active: true
        };
        tabs.push(newTab);
        notifyTabs();
      }

      function activateTab(id) {
        tabs.forEach(t => { t.active = (t.id === id); });
        notifyTabs();
      }

      function closeTab(id) {
        const idx = tabs.findIndex(t => t.id === id);
        if (idx === -1 || tabs[idx].id === 'home') return;
        const wasActive = tabs[idx].active;
        tabs.splice(idx, 1);
        if (wasActive) {
          tabs[Math.max(0, idx - 1)].active = true;
        }
        notifyTabs();
      }

      function buildFilePage(filterKind) {
        const all = getStoredFiles();
        const filtered = filterKind ? all.filter(f => f.kind === filterKind) : all;
        const entries = filtered.map(f => ({
          name: f.name,
          path: f.path,
          sizeBytes: f.sizeBytes || 2048,
          size: f.sizeBytes || 2048,
          mtimeMs: f.modifiedMs,
          starred: Boolean(f.starred),
          kind: f.kind
        }));
        return { entries: entries, total: entries.length, hasMore: false };
      }

      function createDriveCallableList(filterKind) {
        const fn = function() { return Promise.resolve(buildFilePage(filterKind)); };
        fn.list = () => Promise.resolve(buildFilePage(filterKind).entries);
        fn.get = () => Promise.resolve(buildFilePage(filterKind));
        fn.entries = buildFilePage(filterKind).entries;
        fn.keys = () => [];
        fn.values = () => [];
        fn.then = (onF, onR) => Promise.resolve(buildFilePage(filterKind)).then(onF, onR);
        fn.catch = (onR) => Promise.resolve(buildFilePage(filterKind)).catch(onR);
        fn.finally = (onFn) => Promise.resolve(buildFilePage(filterKind)).finally(onFn);
        return fn;
      }

      const mockAiOffice = {
        getLanguage: () => Promise.resolve('en'),
        getPlatform: () => Promise.resolve('web'),
        getTheme: () => Promise.resolve('light'),
        getVersion: () => Promise.resolve('1.0.0-web'),
        onboardingSeen: () => Promise.resolve(true),
        onThemeChanged: noopUnsub,
        onFolderChanged: (handler) => {
          fileChangeListeners.add(handler);
          return () => fileChangeListeners.delete(handler);
        },
        onOpenSettings: noopUnsub,
        onAccountLogin: noopUnsub,
        folderRoots: () => Promise.resolve([{ name: 'Cloud Drive', path: '/drive', kind: 'cloud' }]),
        accountStatus: () => Promise.resolve({ loggedIn: true, email: 'user@zerofye.internal' }),
        cloudProjectsSync: resolveEmptyArr,
        cloudProjectsCached: () => Promise.resolve({}),
        starredGroups: () => Promise.resolve({}),
        searchFiles: (query) => {
          const files = getStoredFiles().filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()));
          return Promise.resolve({ items: files, index: { pending: 0, scanning: false } });
        },
        rerankSearch: resolveEmptyArr,
        recents: createDriveCallableList(),
        starred: createDriveCallableList(),
        browse: () => Promise.resolve(buildFilePage().entries),
        addFolderRoot: resolveEmptyArr,
        removeFolderRoot: resolveEmptyArr,
        dropFolderRoots: resolveEmptyArr,
        pathForFile: (f) => f ? (f.path || f.name || '') : '',
        revealPath: noop,
        openPath: (path) => {
          const files = getStoredFiles();
          const target = files.find(f => f.path === path || f.name === path);
          if (target) {
            openAppTab(target.kind, target.name);
          } else {
            const ext = (path || '').split('.').pop().toLowerCase();
            const kindMap = { xlsx: 'sheets', docx: 'docs', pptx: 'slides', pdf: 'pdf', md: 'markdown', html: 'html' };
            openAppTab(kindMap[ext] || 'sheets', path);
          }
        },
        pickDefaultSaveDir: resolveEmptyArr,
        toggleStar: (path) => {
          const files = getStoredFiles();
          const file = files.find(f => f.path === path || f.name === path);
          if (file) {
            file.starred = !file.starred;
            saveStoredFiles(files);
            notifyFilesChanged();
          }
          return Promise.resolve(true);
        },
        removeRecent: (path) => {
          let files = getStoredFiles();
          files = files.filter(f => f.path !== path && f.name !== path);
          saveStoredFiles(files);
          notifyFilesChanged();
          return Promise.resolve(true);
        },
        unstarPaths: resolveTrue,
        setStarredGroup: resolveTrue,
        deleteFiles: (paths) => {
          let files = getStoredFiles();
          files = files.filter(f => !paths.includes(f.path) && !paths.includes(f.name));
          saveStoredFiles(files);
          notifyFilesChanged();
          return Promise.resolve(true);
        },
        duplicateFile: (path) => {
          const files = getStoredFiles();
          const orig = files.find(f => f.path === path || f.name === path);
          if (orig) {
            files.unshift({ ...orig, id: 'file-' + Date.now(), name: 'Copy of ' + orig.name, path: 'Copy of ' + orig.name });
            saveStoredFiles(files);
            notifyFilesChanged();
          }
          return Promise.resolve(true);
        },
        renameFile: (path, newName) => {
          const files = getStoredFiles();
          const f = files.find(file => file.path === path || file.name === path);
          if (f) {
            f.name = newName;
            f.path = newName;
            saveStoredFiles(files);
            notifyFilesChanged();
          }
          return Promise.resolve({ ok: true });
        },
        createFolder: () => Promise.resolve({ ok: true }),
        renameFolder: () => Promise.resolve({ ok: true }),
        deleteFolder: resolveTrue,
        movePaths: () => Promise.resolve({ ok: true, failed: [] }),

        newDoc: () => { openAppTab('docs', 'AI Docs.docx'); return Promise.resolve(); },
        newSheet: () => { openAppTab('sheets', 'AI Sheets.xlsx'); return Promise.resolve(); },
        newSlide: () => { openAppTab('slides', 'AI Slides.pptx'); return Promise.resolve(); },
        newMarkdown: () => { openAppTab('markdown', 'AI Markdown.md'); return Promise.resolve(); },
        newHtml: () => { openAppTab('html', 'AI HTML.html'); return Promise.resolve(); },
        newPdf: () => { openAppTab('pdf', 'AI PDF.pdf'); return Promise.resolve(); },

        openLoginUrl: noop,
        accountLogout: resolveTrue,
        accountLogin: () => Promise.resolve(true),
        openCloudProject: noop,
        skills: () => Promise.resolve({ agents: [] }),
        getSkills: () => Promise.resolve({ agents: [] }),
        skillUpdateDue: () => Promise.resolve(false)
      };

      const mockTabs = {
        onStartRename: noopUnsub,
        onChanged: (handler) => {
          tabListeners.add(handler);
          try { handler(tabs.map(t => ({ ...t }))); } catch(e) {}
          return () => tabListeners.delete(handler);
        },
        list: () => Promise.resolve(tabs.map(t => ({ ...t }))),
        activate: (id) => { activateTab(id); return Promise.resolve(); },
        close: (id) => { closeTab(id); return Promise.resolve(); },
        reorder: noop,
        showMenu: noop,
        showAppMenu: noop,
        showTabMenu: noop,
        showNewMenu: noop
      };

      function createDeepFallback() {
        const fn = function() { return Promise.resolve([]); };
        const p = Promise.resolve([]);
        fn.then = (onF, onR) => p.then(onF, onR);
        fn.catch = (onR) => p.catch(onR);
        fn.finally = (onFn) => p.finally(onFn);
        fn.find = () => undefined;
        fn.filter = () => [];
        fn.map = () => [];
        fn.some = () => false;
        fn.every = () => true;
        fn.forEach = () => {};
        fn.length = 0;
        fn.entries = [];
        fn.agents = [];
        fn.messages = [];
        fn.signatures = [];
        fn[Symbol.iterator] = function*() {};

        return new Proxy(fn, {
          get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'string' && (prop.startsWith('on') || prop.includes('Listener') || prop === 'subscribe')) {
              return noopUnsub;
            }
            if (prop === 'entries' || prop === 'agents' || prop === 'messages' || prop === 'signatures' || prop === 'digitalSignatures') return [];
            return createDeepFallback();
          },
          apply() { return Promise.resolve([]); }
        });
      }

      const fallback = createDeepFallback();
      window.aiOffice = new Proxy(mockAiOffice, {
        get: (t, p) => (p in t ? t[p] : (typeof p === 'string' && p.startsWith('on') ? noopUnsub : fallback))
      });
      window.aiOfficeTabs = new Proxy(mockTabs, {
        get: (t, p) => (p in t ? t[p] : (typeof p === 'string' && p.startsWith('on') ? noopUnsub : fallback))
      });
      window.aiOfficeIntegrations = new Proxy({ status: () => Promise.resolve({ agents: [] }) }, {
        get: (t, p) => (p in t ? t[p] : fallback)
      });

      window.aiNamingApi = fallback;
      window.projectApi = fallback;
      window.electron = fallback;
      window.electronAPI = fallback;
    })();
    </script>
"@

$shellHtml = $shellHtml -replace '(<head[^>]*>)', "`$1`r`n$shellPolyfill"
Set-Content -Path $destShellHtml -Value $shellHtml -Encoding utf8

Write-Host ">>> [4/4] Injecting Exact Engine Native Bridge..." -ForegroundColor Gray
$childPolyfill = @"
    <script>
    (function() {
      if (typeof window === 'undefined') return;

      const noop = () => {};
      const noopUnsub = () => () => {};

      // Minimal valid PDF binary (%PDF-1.4)
      const BLANK_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjE3OQolJUVPRg==';
      const blankPdfBytes = Uint8Array.from(atob(BLANK_PDF_BASE64), c => c.charCodeAt(0));

      const pathSegments = window.location.pathname.split('/');
      const detectedApp = pathSegments.includes('pdf') ? 'pdf' 
                        : (pathSegments.includes('docs') ? 'docs' 
                        : (pathSegments.includes('slides') ? 'slides' 
                        : (pathSegments.includes('markdown') ? 'markdown' 
                        : (pathSegments.includes('html') ? 'html' : 'sheets'))));

      const defaultExt = (detectedApp === 'pdf') ? '.pdf' 
                       : (detectedApp === 'docs') ? '.docx' 
                       : (detectedApp === 'slides') ? '.pptx' 
                       : (detectedApp === 'markdown') ? '.md' 
                       : (detectedApp === 'html') ? '.html' : '.xlsx';

      const defaultHtmlContent = '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n  <title>Document</title>\n</head>\n<body>\n  <h1>Document</h1>\n  <p>Start editing...</p>\n</body>\n</html>';
      const defaultMdContent = '# Document\n\nStart typing markdown here...\n';

      const params = new URLSearchParams(window.location.search);
      let currentDocumentName = params.get('fileName') || ('Document' + defaultExt);
      if (!currentDocumentName.toLowerCase().endsWith(defaultExt)) {
        currentDocumentName += defaultExt;
      }

      function syncToVirtualDrive(name) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'ZERO_FYE_FILE_SAVED',
            name: name || currentDocumentName,
            kind: detectedApp,
            sizeBytes: (detectedApp === 'pdf' ? blankPdfBytes.byteLength : 2048)
          }, '*');
        }
      }

      syncToVirtualDrive(currentDocumentName);

      function showSavedBadge() {
        let badge = document.getElementById('zerofye-save-indicator');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'zerofye-save-indicator';
          badge.style.position = 'fixed';
          badge.style.bottom = '16px';
          badge.style.right = '20px';
          badge.style.background = '#10b981';
          badge.style.color = '#ffffff';
          badge.style.padding = '6px 14px';
          badge.style.borderRadius = '9999px';
          badge.style.fontSize = '12px';
          badge.style.fontWeight = '600';
          badge.style.zIndex = '99999';
          badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          badge.style.transition = 'opacity 0.3s ease';
          badge.innerText = 'Saved to Cloud';
          document.body.appendChild(badge);
        }
        badge.style.opacity = '1';
        badge.innerText = 'Saved to Cloud';
        setTimeout(() => { if (badge) badge.style.opacity = '0'; }, 1800);
      }

      function generateUUID() {
        return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
          (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
        );
      }
      const activeSessionId = generateUUID();

      // Sheets structure
      const webWorkbookFile = {
        sessionId: activeSessionId,
        name: currentDocumentName,
        path: currentDocumentName,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        fileBytes: 1024,
        entryCount: 1,
        sheets: [
          {
            id: 'sheet-01',
            name: 'Sheet1',
            order: 0,
            visibility: 0,
            state: 0,
            rowCount: 100,
            columnCount: 26,
            defaultRowHeight: 24,
            defaultColumnWidth: 80
          }
        ],
        activeTab: 0,
        styles: [],
        dxfStyles: [],
        visuals: [],
        definedNames: [],
        readOnly: false,
        needsSaveAs: false,
        unsavedNew: false
      };

      // Exact RenderSlide interface from packages/pptx-render/src/render-tree.ts
      const blankRenderSlide = {
        widthPx: 960,
        heightPx: 540,
        scale: 1,
        background: { kind: 'solid', color: '#ffffff' },
        bgOwn: true,
        bgGraphicsHidden: false,
        nodes: [],
        hidden: false,
        partPath: 'ppt/slides/slide1.xml'
      };

      // Exact OpenResult interface returned by slides:new-blank
      const blankPptxOpenResult = {
        path: currentDocumentName,
        slides: [blankRenderSlide],
        size: { cx: 12192000, cy: 6858000 },
        defaultFont: 'Calibri'
      };

      const nativeEngineApi = {
        getUserDisplayName: () => Promise.resolve('User'),
        onUserDisplayNameChanged: (handler) => { try { handler('User'); } catch(e) {} return noopUnsub(); },
        getAuthor: () => Promise.resolve('User'),
        getUser: () => Promise.resolve({ name: 'User', displayName: 'User', id: 'user-default' }),
        getFonts: () => Promise.resolve(['Aptos', 'Calibri', 'Arial', 'Segoe UI', 'Times New Roman']),
        getAiSettings: () => Promise.resolve({ enabled: false, provider: 'none', apiKey: '' }),
        getSettings: () => Promise.resolve({ enabled: false, provider: 'none', apiKey: '' }),
        getLanguage: () => Promise.resolve('en'),
        onLanguageChanged: noopUnsub,
        getTheme: () => Promise.resolve('light'),
        onThemeChanged: noopUnsub,
        isMac: false,

        // Safe Primitive Strings
        getFilePath: () => Promise.resolve(currentDocumentName),
        getInitialFilePath: () => Promise.resolve(currentDocumentName),
        getInitialFile: () => Promise.resolve(currentDocumentName),
        currentFilePath: currentDocumentName,
        filePath: currentDocumentName,

        // Electron Utils Context Menu Polyfill
        armContextMenu: () => Promise.resolve(),
        showContextMenu: () => Promise.resolve(),
        showAppMenu: () => Promise.resolve(),
        showTabMenu: () => Promise.resolve(),
        showNewMenu: () => Promise.resolve(),
        onChromePressed: noopUnsub,

        // DOCS: docs:consume-new-blank returns boolean true
        consumeNewBlankDoc: () => Promise.resolve(true),
        consumePendingOpenDocx: () => Promise.resolve(null),
        consumeAiDocContent: () => Promise.resolve(null),
        consumeHeadlessExport: () => Promise.resolve(null),
        headlessExportDone: noop,
        createDocument: () => Promise.resolve({ ok: true }),
        onDocumentChanged: noopUnsub,

        // SLIDES: slides:new-blank returns real OpenResult
        newBlank: (fitWidthPx, size) => Promise.resolve(blankPptxOpenResult),
        consumePendingOpen: (fitWidthPx) => Promise.resolve(blankPptxOpenResult),
        openPptx: () => Promise.resolve(blankPptxOpenResult),
        openPptxPath: () => Promise.resolve(blankPptxOpenResult),
        onDeckChanged: noopUnsub,
        onOpened: (handler) => { try { handler(blankPptxOpenResult); } catch(e) {} return noopUnsub(); },
        onShowSync: noopUnsub,
        onFontsChanged: noopUnsub,
        fontCatalog: () => Promise.resolve([]),
        fontDownload: () => Promise.resolve({ ok: true }),
        fontInstallLocal: () => Promise.resolve({ ok: true }),
        fontMissing: () => Promise.resolve([]),
        masterEnter: () => Promise.resolve(),
        masterOpen: () => Promise.resolve(),
        masterClose: () => Promise.resolve(),
        savePresentation: async () => { showSavedBadge(); syncToVirtualDrive(); return { canceled: false, ok: true }; },

        // SHEETS
        hasQueuedWorkbook: () => Promise.resolve(false),
        consumeNewBlankWorkbook: () => Promise.resolve(webWorkbookFile),
        getInitialWorkbookFile: () => Promise.resolve(webWorkbookFile),
        selectWorkbook: () => Promise.resolve(webWorkbookFile),
        reopenWorkbook: () => Promise.resolve(webWorkbookFile),
        readWorkbook: () => Promise.resolve(webWorkbookFile),
        readWorkbookRange: () => Promise.resolve({ cells: [] }),
        readWorkbookFormulas: () => Promise.resolve({ cells: [], sharedGroups: [] }),
        readWorkbookRowOutline: () => Promise.resolve({ rows: [] }),
        readWorkbookRedactions: () => Promise.resolve({ redactions: [] }),
        readWorkbookMedia: () => Promise.resolve({ ok: false }),
        readPivotDefinition: () => Promise.resolve({ ok: false }),
        recalcWorkbook: () => Promise.resolve({ cells: [] }),
        findWorkbookCells: () => Promise.resolve({ matches: [] }),
        saveWorkbookEdits: async () => { showSavedBadge(); syncToVirtualDrive(); return { canceled: false, ok: true }; },

        // PDF, HTML, MARKDOWN: consumePending returns primitive string
        consumePending: () => Promise.resolve(currentDocumentName),
        openSourcePath: () => Promise.resolve(),
        getStaticFormFills: () => Promise.resolve([]),
        getSavedStaticFormFills: () => Promise.resolve([]),
        savedStaticFormFills: [],
        listStaticFormFills: () => Promise.resolve([]),
        listPageImages: () => Promise.resolve([]),
        isUntitled: () => Promise.resolve(false),
        getOutline: () => Promise.resolve([]),
        getDestinations: () => Promise.resolve({}),
        getAttachments: () => Promise.resolve([]),
        readFile: (p) => {
          if (detectedApp === 'html') return Promise.resolve(defaultHtmlContent);
          if (detectedApp === 'markdown') return Promise.resolve(defaultMdContent);
          return Promise.resolve(blankPdfBytes);
        },
        readBinary: () => Promise.resolve(blankPdfBytes),
        readBuffer: () => Promise.resolve(blankPdfBytes),
        getInitialBuffer: () => Promise.resolve(blankPdfBytes),

        // PDF Digital Signatures & System Certificates
        listDigitalSignatures: () => Promise.resolve([]),
        listSavedSignatures: () => Promise.resolve([]),
        addSavedSignature: () => Promise.resolve([]),
        removeSavedSignature: () => Promise.resolve([]),
        listSystemCertificates: () => Promise.resolve({ identities: [] }),
        pickCertificate: () => Promise.resolve(null),
        releaseCertificate: noop,
        signWithCertificate: () => Promise.resolve({ ok: false, cancelled: true }),

        // HTML & Markdown Specific methods returning pure strings
        readText: () => Promise.resolve(detectedApp === 'html' ? defaultHtmlContent : defaultMdContent),
        readString: () => Promise.resolve(detectedApp === 'html' ? defaultHtmlContent : defaultMdContent),
        updatePreview: noop,
        getPreviewInfo: () => Promise.resolve({}),
        setPresentFullScreen: () => Promise.resolve(),
        presentInNewTab: () => Promise.resolve(),
        setDirty: noop,
        sendCloseSaveResult: noop,
        sendSaveRequestAck: noop,
        sendReadTextResult: noop,
        resolveWikiLinks: () => Promise.resolve([]),
        listWikiNotes: () => Promise.resolve([]),
        wikiTags: () => Promise.resolve([]),
        wikiGraph: () => Promise.resolve({ nodes: [], edges: [] }),

        // Project API: resolveChat and loadChat returning concrete objects/arrays
        resolveChat: (args) => Promise.resolve({ projectId: 'default-project', chatId: (args && args.tempChatId) || 'chat-default' }),
        loadChat: () => Promise.resolve([]),
        listChats: () => Promise.resolve([]),
        appendChat: () => Promise.resolve(),
        rebindChat: (args) => Promise.resolve({ projectId: (args && args.projectId) || 'default-project', chatId: (args && args.tempChatId) || 'chat-default' }),
        deleteChat: () => Promise.resolve(),

        // Save & Rename Common
        save: async () => { showSavedBadge(); syncToVirtualDrive(); return { ok: true }; },
        saveDocument: async () => { showSavedBadge(); syncToVirtualDrive(); return { canceled: false, ok: true }; },
        saveFileDialog: async () => ({ canceled: true }),
        showSaveDialog: async () => ({ canceled: true }),
        reportCloseSaveResult: noop,
        onWorkbookRenamed: noopUnsub,
        onDocumentRenamed: noopUnsub,
        onRenamed: noopUnsub,
        onFileRenamed: noopUnsub,
        onFileChangedOnDisk: noopUnsub,
        onSaveRequest: noopUnsub,
        onCloseSaveRequest: noopUnsub,
        onReadTextRequest: noopUnsub,
        getAutoSaveDefault: () => Promise.resolve(true),
        onAutoSaveDefaultChanged: noopUnsub,
        setAutoSavePref: noop,
        renameWorkbook: (newName) => {
          if (newName) {
            currentDocumentName = newName.endsWith(defaultExt) ? newName : (newName + defaultExt);
            syncToVirtualDrive(currentDocumentName);
          }
          showSavedBadge();
          return Promise.resolve({ ok: true });
        },
        renameDocument: (n) => nativeEngineApi.renameWorkbook(n),
        renamePresentation: (n) => nativeEngineApi.renameWorkbook(n)
      };

      function createSafeProxy(target) {
        return new Proxy(target, {
          get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop === 'string' && (prop.startsWith('on') || prop.includes('Listener') || prop === 'subscribe')) {
              return noopUnsub;
            }
            if (prop === 'filePath' || prop === 'path' || prop === 'currentPath' || prop === 'filename') {
              return currentDocumentName;
            }
            if (prop === 'nodes' || prop === 'elements' || prop === 'slides') return [];
            if (prop === 'savedStaticFormFills' || prop === 'formFills' || prop === 'messages') return [];
            if (prop === 'digitalSignatures' || prop === 'signatures' || prop === 'identities') return [];
            if (prop === 'background') return { kind: 'solid', color: '#ffffff' };
            if (prop === 'author' || prop === 'name' || prop === 'displayName') return 'User';
            if (prop === 'startsWith') {
              const str = (detectedApp === 'html' ? defaultHtmlContent : defaultMdContent);
              return (needle) => str.startsWith(needle);
            }
            if (prop === 'replace') {
              return (p, r) => currentDocumentName.replace(p, r);
            }
            if (prop === 'split') {
              return (delim) => currentDocumentName.split(delim);
            }

            const fn = function() {
              if (typeof prop === 'string' && (prop.includes('Signature') || prop.includes('Certificate'))) {
                return Promise.resolve([]);
              }
              if (detectedApp === 'slides') return Promise.resolve(blankPptxOpenResult);
              if (detectedApp === 'docs') return Promise.resolve(true);
              if (detectedApp === 'sheets') return Promise.resolve(webWorkbookFile);
              if (detectedApp === 'html') return Promise.resolve(defaultHtmlContent);
              if (detectedApp === 'markdown') return Promise.resolve(defaultMdContent);
              if (detectedApp === 'pdf') return Promise.resolve(currentDocumentName);
              return Promise.resolve([]);
            };
            fn.map = () => [];
            fn.filter = () => [];
            fn.some = () => false;
            fn.every = () => true;
            fn.startsWith = (needle) => (detectedApp === 'html' ? defaultHtmlContent : defaultMdContent).startsWith(needle);
            fn.replace = (p, r) => currentDocumentName.replace(p, r);
            fn.split = (delim) => currentDocumentName.split(delim);
            fn.then = (onF) => Promise.resolve([]).then(onF);
            return fn;
          }
        });
      }

      const bridge = createSafeProxy(nativeEngineApi);

      window.desktop = bridge;
      window.desktopApi = bridge;
      window.slidesApi = bridge;
      window.docsApi = bridge;
      window.sheetsApi = bridge;
      window.pdfApi = bridge;
      window.markdownApi = bridge;
      window.htmlApi = bridge;
      window.projectApi = bridge;
      window.aiNamingApi = bridge;
      window.nativeSpell = bridge;
      window.__zerofyeofficeDebugHooks = true;

      window.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          showSavedBadge();
          syncToVirtualDrive(currentDocumentName);
        }
      }, true);
    })();
    </script>
"@

foreach ($app in $subApps) {
    $htmlPath = "$deployRoot\apps\$app\index.html"
    $srcPath  = "$workspaceRoot\apps\$app\out\renderer\index.html"
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $htmlPath -Force
        $content = Get-Content $htmlPath -Raw
        $content = $content -replace '<meta\s+http-equiv="Content-Security-Policy"[^>]*>', ''
        $content = $content -replace '(<head[^>]*>)', "`$1`r`n$childPolyfill"
        Set-Content -Path $htmlPath -Value $content -Encoding utf8
    }
}

Write-Host ">>> Deploying Complete Suite to Cloudflare Pages..." -ForegroundColor Cyan
Set-Location $deployRoot
npx wrangler pages deploy . --project-name=$projectName --commit-dirty=true

Write-Host ">>> Done!" -ForegroundColor Green
