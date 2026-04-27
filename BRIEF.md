# Unspark — design brief for Claude Design

## §1. Цель

Сделать **нативный macOS-интерфейс десктопного AI-приложения Unspark** — утилиты, которая удаляет sparkle-водяной знак Google Nano Banana / Gemini с сгенерированных изображений. Приложение работает локально (LaMa inpainting в Python под капотом) — пользователь видит только интерфейс, никаких терминалов, прогресс-баров командной строки, диалогов установки.

**Подцели (измеримые):**
1. Time-to-first-result ≤ 3 сек после первого запуска (drop файл → сразу процесс, никаких onboarding-стен).
2. Воспринимаемая премиум-планка не ниже Pixelmator Pro / Linear / Raycast — пользователь должен чувствовать, что заплатил бы $30, хотя это бесплатно и open-source.
3. Zero-emoji, zero-cliches, zero-corporate. Каждый текст и каждая иконка — авторские.

**Главная метрика успеха:** доля пользователей, которые после первой обработки делают вторую (повторное использование). Цель — 70%+. Если интерфейс плохой, человек один раз снимет ватермарку и удалит app. Хороший интерфейс заставляет приходить снова.

## §2. Что плохо в текущей версии

Сейчас **NB Unmark.app** работает так: пользователь дропает файл на иконку → открывается Terminal → бегут логи → файл сохраняется в `~/Library/Application Support/NB Unmark/water_out/` → Finder открывает папку.

Конкретно плохо:

- **Терминал** — главный криминал. Современный пользователь macOS видит чёрный prompt-prompt и ассоциирует это с хакерским/недоделанным софтом.
- **Нет визуального фидбека** во время обработки. ~7 секунд тишины, только текст "Processing..." в Terminal.
- **Нет before/after** — пользователь должен сам открыть две папки и сравнить.
- **Нет drag-and-drop хитбокса** — drop работает только на иконку приложения в Dock или Finder.
- **Нет batch-индикатора** — если кинули 10 файлов, видно только counter в логе.
- **Иконка** — сразу Apple ✨ emoji rendered as bitmap. Это милое затыкание дырки, но не айдентика.
- **Нет имени** — "NB Unmark" звучит как abbreviation от "Nota Bene", не запоминается.

## §3. Что переделываем / что НЕ трогаем

**Переделываем (всё под капотом скрыто):**
- Главное окно приложения (фиксированный размер, native macOS chrome)
- Состояния: idle / drag-over / processing / result / batch / error
- Drag-and-drop зона
- Прогресс-индикатор обработки (анимированный, не linear bar)
- Before/after сравнение результата (slider или toggle)
- Иконка приложения (.icns)
- About-окно с кредитами
- Voice/copy всех текстовых элементов

**НЕ трогаем (бэкенд работает):**
- Python-бэкенд (LaMa + OpenCV detection) — остаётся as-is, вызывается через PyWebView bridge
- Bundled standalone Python distribution (777 МБ, не наш bundle никуда не денем)
- big-lama.pt веса (196 МБ внутри bundle)
- Алгоритм детекции спарка (cv2 multi-scale template matching)
- Файловая структура `~/Library/Application Support/Unspark/`

## §4. Визуальная ДНК

### Платформа

**macOS native app window** — НЕ веб-лендинг, НЕ полноэкранный сайт.
- Размер окна: **840 × 600 px** (фиксированный, не resizable до полировки)
- Native title bar с traffic lights (close/min/zoom) — left-aligned macOS-стиль
- Material: vibrancy (опционально через `apple-system` fallback)
- Светлая и тёмная темы (auto-switch по системе)
- Border-radius окна: 12px (macOS Big Sur+)

### Цвета

**Light mode:**
- Background: `#FAFAFA` (off-white, не чистый белый — мягче для глаз)
- Surface: `#FFFFFF` (карточки, drop-zone)
- Text primary: `#0A0A0A`
- Text secondary: `#6B7280`
- Border: `#E5E5E7`
- Accent: `#5B5BD6` (приглушённый indigo — серьёзно, не игриво)

**Dark mode:**
- Background: `#0A0A0B` (почти-чёрный, не #000)
- Surface: `#141415`
- Text primary: `#F5F5F7`
- Text secondary: `#8E8E93`
- Border: `#2A2A2C`
- Accent: `#7C7CFF` (тот же indigo, светлее для контраста)

**Sparkle accent gradient** — используется ТОЛЬКО в одном месте: на иконке самого спарка (см. §5 state "Processing" и логотип). Цвета взяты из реального Gemini sparkle, использованы иронично — мы используем цвета ватермарки против неё:
- Stop 0%: `#4FC3F7` (cyan)
- Stop 50%: `#9C27B0` (purple)
- Stop 100%: `#FF6EC7` (pink)

### Типографика

**System stack only** (никаких custom-шрифтов):
- Display: `-apple-system, BlinkMacSystemFont` (San Francisco)
- Mono: `'SF Mono', Menlo, monospace` — для технических элементов (filename, file size, processing log если оставим)

**Шкала:**
- H1 (window title): 22px / 600 weight / -0.02em letter-spacing
- H2: 17px / 600
- Body: 13px / 400
- Caption: 11px / 400 / text-secondary
- Mono: 12px / 400

### Spacing

- Grid: 8pt baseline (8, 16, 24, 32, 48, 64)
- Window padding: 32px
- Drop zone inner padding: 64px
- Card gap: 16px

### Corner radius

- Window: 12
- Cards / drop zone: 16
- Buttons: 8
- Pills / tags: 999 (full round)

### Анимации

**Принцип:** spring-физика, не linear/ease. Конкретные tokens:
- Standard: `cubic-bezier(0.25, 0.46, 0.45, 0.94)`, 280ms
- Spring (entrance): `spring(stiffness: 0.8, damping: 0.6)` — 320ms feel
- Micro-interactions (hover, tap): 120ms ease-out

**Где обязательны анимации:**
1. **Sparkle-shimmer** на logo при idle: лёгкое мерцание точек спарка, 4-сек цикл
2. **Drop zone reveal**: при drag-over зона расширяется на 4px и подсвечивается accent с opacity 0.08
3. **Processing**: круговая анимация со sparkle-gradient, 1.4-сек цикл, замедляется к концу
4. **Result reveal**: before-картинка fade-in, потом sparkle-particles "сдуваются" с неё, потом after fade-in поверх (последовательность ~600ms total)
5. **Before/after slider**: при перетаскивании ручки — spring resistance к центру

## §5. Контентные блоки (= states окна)

App — это одно окно с несколькими state-ами. Браться по порядку:

### 5.1. Idle (empty)
**Сообщение:** "Drop a Gemini image. We strip the sparkle."

Лейаут:
- Window header: лого Unspark (миниатюра 24x24) слева + "Unspark" wordmark + "About" link справа
- Большая drop-zone в центре, ~600×320, dashed border 1.5px (border color = $border)
- Внутри drop-zone: ✦-icon (custom inline SVG, gradient, 64×64), под ним заголовок "Drop image here", под ним hint "or click to choose"
- Внизу окна status-bar: "Ready · Local · Offline" (text-secondary, 11px)

### 5.2. Drag-over
- Drop-zone подсвечивается: border переходит в solid 2px accent, фон становится $accent с opacity 0.04
- Sparkle-icon начинает медленно вращаться (4-секундный rotate-360)
- Текст меняется на "Drop now"

### 5.3. Processing (single file)
- Drop-zone превращается в processing-card: показывается thumbnail dropped image (с blur effect, opacity 0.6)
- В центре поверх — circular progress (sparkle-gradient, 80×80)
- Под ним: filename (mono, 12px, truncated) + размер
- Сообщение: "Reading the sparkle…" → "Erasing…" → "Almost there…" (text меняется по таймеру 2.5s/2.5s/finish)
- Cancel-кнопка в углу (опционально)

### 5.4. Result (single file)
- Большой before/after compare-slider (~720×360) — handle с двумя стрелками, sparkle-точкой по центру handle
- Под ним два action-button рядом: "Save…" (primary, accent) и "Process more" (secondary, outline)
- Сверху mini-stats: "Removed in 7.2s · LaMa local" (mono caption)
- Кнопка "Reveal in Finder" — иконка-only

### 5.5. Batch (multiple files dropped at once)
- Drop-zone схлопывается в header-card с counter "Processing 12 images…"
- Под ним список файлов: каждый row = thumbnail (32×32) + filename + status (queued / processing / done с галочкой / error)
- Done-row подсвечивается зелёным акцентом 0.04 на 600ms потом возвращается
- Внизу прогресс по всему батчу: "9 of 12 done"
- В конце — "Open output folder" CTA + "Process more"

### 5.6. Error (unsupported file / detection failed)
- Inline error на drop-zone: красноватый border 0.6 saturation
- Сообщение: "This isn't an image we can read." (для bad file) или "Couldn't find a sparkle to remove." (если detection score < threshold)
- Action: "Try again" / "Use it anyway (manual mask)"

### 5.7. About modal
- Modal окно ~480×400, glass-vibrancy фон
- Лого Unspark крупный (96×96), wordmark, версия (v1.0)
- Описание (1-2 строки): "A local sparkle remover for Gemini images. No cloud, no signup, no nonsense."
- **Credits:**
  - "Built by Alexey Evdokimov"
  - Link: "evdokimov.ai" (с подчёркиванием)
- **Tech:**
  - "Powered by LaMa (large-mask inpainting, FFC) — advimman/lama"
  - "Free and open source"
- Close-кнопка

## §5а. Маркетинговый контекст (тон/позиционирование)

**Целевая аудитория:**
- AI-power-users: prompt-engineers, designers, индихакеры, AI-арт-creators
- Возраст ~25-40, активны в Twitter/X, Reddit r/StableDiffusion, Discord-серверах
- Используют Gemini/Nano Banana ежедневно для concept art, social media visuals, prototyping
- **Конкретный pain:** платят $20/мес за Gemini Pro и всё равно получают watermark на каждом выходе. По API watermark нет, но у большинства нет API-доступа или времени на интеграцию

**Конкуренты в нише:**
- Runway, Topaz, Pixelmator Magic Eraser — общие inpainting-инструменты, не специфика
- Online watermark-removers — все cloud-based, шлют ваши картинки на чужой сервер, медленные, с лимитами
- **Unspark делает одну вещь идеально:** только Gemini-sparkle, мгновенно, локально, бесплатно

**Позиционирование:**
- "Indie-tool, который сделал один человек, потому что бесила ватермарка"
- Подчёркиваем: local, offline, free, open-source
- Не подчёркиваем: AI, ML, нейросети — наша целевая уже знает, что под капотом нейронка
- Лёгкая ирония: используем sparkle-gradient в нашей же иконке (но НЕ в виде ватермарки) — в дизайне это видно, в текстах не разъясняем

## §6. Копирайтинг мандат

**Голос Unspark:**
- Прямой, технически грамотный, чуть subversive
- Confident без хвастовства
- Ноль corporate-filler ("amazing", "powerful", "seamless")
- Tone reference: **Linear** (terse, factual), **Raycast** (smart but warm), **early Apple** (declarative)

**Словарь бренда (whitelist примеров):**
- "Strip the sparkle"
- "No cloud. No signup."
- "Local processing"
- "Drop. Done."
- "Erased in seconds"
- "Built by one person, runs on your Mac"
- "Open source"

**Запрещённые паттерны (humanizer-правила):**

| Паттерн | Запрещён |
|---|---|
| Em dashes (—) вместо запятых | да |
| Rule of three ("speed, quality, simplicity") | да |
| AI-vocabulary: crucial, delve, leverage, seamless, robust, unleash, empower, unlock, transformative | да |
| Negative parallelism: "Not just X, but Y" | да |
| Промо-эпитеты: groundbreaking, revolutionary, cutting-edge | да |
| Sycophantic intro: "Welcome to Unspark!", "We're excited to..." | да |
| Generic positive ending: "exciting times ahead" | да |
| Curly quotes "..." | да, использовать прямые "..." |
| Emoji в headings | да |
| Title Case In Headings | да, использовать sentence case |

**Образцы реплик:**

- Window title: "Unspark"
- Idle hero: "Drop a Gemini image."
- Idle subtext: "We strip the sparkle. Locally."
- Processing: "Reading the sparkle…"
- Done state: "Done in 7.2 seconds."
- Error: "This file isn't an image."
- Empty state batch done: "12 images, no sparkles."
- About one-liner: "A local sparkle remover for Gemini images. No cloud, no signup, no nonsense."
- Save dialog title: "Save unsparkled image"

## §7. Технические ограничения

**Формат вывода Claude Design — standalone HTML/CSS/JS** который мы потом обернём в **PyWebView** (Python нативный webview-wrapper):

- Один HTML-файл с inline CSS+JS (или внешние файлы при handoff)
- НЕ использовать React/Vue/Svelte — vanilla JS only (PyWebView не любит heavy bundles)
- Никаких CDN-зависимостей, всё локально
- System fonts only (см. §4)
- **ZERO эмодзи** — все иконки = inline SVG, line-style 1.5px stroke (исключение: сам spark-логотип — он gradient, fill-style)
- Mobile-first НЕ нужен — это desktop-app, fixed-size 840×600
- Поддержать `prefers-color-scheme: light` и `dark` через CSS-variables
- Анимации — pure CSS + Web Animations API. Никаких lottie/GSAP/external libs
- **Безопасный bridge между HTML и Python:** считай что доступен глобальный `window.unspark` объект с методами:
  - `unspark.processFile(path) → Promise<{outputPath, durationMs, score}>`
  - `unspark.processBatch(paths[]) → emits 'progress' event`
  - `unspark.openInFinder(path)`
  - `unspark.saveToPath(srcPath, destPath)`
  - `unspark.openExternal(url)` — для evdokimov.ai links
- File drag-and-drop через стандартный HTML5 dnd API. Drop event получает FileList → передаёт пути в `unspark.processBatch`
- Для before/after slider — vanilla CSS `clip-path` или `mask`, без canvas

**Что Claude Design должен сгенерировать:**

1. `index.html` — главное окно со всеми states (свитчинг по data-state атрибуту корневого элемента: `<body data-state="idle">`)
2. `about.html` — modal, открывается через JS в overlay
3. `assets/spark.svg` — кастомный spark-icon (4-pointed concave star, gradient fill — образец из §4 цветов)
4. `assets/icons/*.svg` — line-icons для UI (folder, save, refresh, x-mark, check, warn, link)
5. `app-icon-source.svg` — векторный source-файл для генерации .icns (1024×1024, sparkle с лёгким glow effect, не плоский Apple-emoji)

## §8. Структура пакета

```
unspark_design_brief_2026-04-27/
├── BRIEF.md                       (этот файл — точка входа)
├── README.md                      (что это и куда смотреть)
├── brand/
│   ├── current_icon.icns          (текущая Apple ✨ emoji иконка — заменим)
│   └── voice_examples.md          (расширенный список voice-образцов)
├── current_state/
│   └── how_it_works_now.md        (описание текущего терминал-flow для контраста)
├── reference/
│   └── visual_dna.md              (референсы: Linear, Raycast, Pixelmator Pro, Topaz)
└── samples/
    ├── sample_before.png          (Gemini map с sparkle)
    └── sample_after.png           (та же карта без sparkle — после LaMa)
```

## §9. Workflow с Claude Design

### Шаг 1 — подключение

1. Открыть claude.ai/design
2. Connect GitHub → установить App `claude-design-import` НА РЕПО `L-tune/unspark`
3. В Claude Design: вставить URL `https://github.com/L-tune/unspark/tree/claude-design-brief`, выбрать branch `claude-design-brief`

### Шаг 2 — стартовый промпт

```
Прочитай BRIEF.md целиком — особенно §4 (визуальная ДНК), §5 (states окна), §6 (копирайтинг мандат), §7 (технические ограничения).

Перед генерацией обязательно посмотри samples/sample_before.png и samples/sample_after.png — это конкретный кейс (карта с/без sparkle), который должен показываться в hero before/after slider в state 5.4 (Result).

Сделай standalone HTML+CSS+vanilla JS макет нативного macOS-app окна Unspark, размер 840×600, fixed. Реализуй все 6 states из §5 (idle, drag-over, processing, result, batch, error) + about-modal из §5.7. Свитчинг state — через data-state атрибут на body, через JS-stub-data (без реального backend).

Стиль: dark mode default + light mode по prefers-color-scheme. Spring-анимации по §4. Spark-icon кастомный — нарисуй inline SVG с тремя стопами gradient, форма 4-конечная concave star (как у Gemini sparkle).

Все тексты — по образцам §6, sentence case, никаких em-dash, никаких emoji.

В About-модалке (§5.7) — обязательно кредиты Алексея Евдокимова со ссылкой на evdokimov.ai.

Не используй React/Vue/любые фреймворки. Только vanilla. Это будет обёрнуто в PyWebView, поэтому JS должен быть лёгкий и без CDN.
```

### Шаг 3 — handoff в Claude Code

После генерации Claude Design предложит handoff. ZIP распакуем, потом я (Claude Code) интегрирую с Python-бэкендом через PyWebView bridge — добавлю `window.unspark` объект, подключу к существующим `detect.py` + `unmark.py` через `webview.start(...)` с js_api.

## §10. Антипаттерны (что НЕ делать)

- **Не делать веб-лендинг.** Это окно приложения. Никаких "hero section", "feature grid", "testimonials". Один экран, шесть states.
- **Не делать onboarding.** Никаких "Welcome to Unspark — let's get started" модалок. Idle state ДОЛЖЕН быть сразу drop-ready.
- **Не использовать Apple ✨ emoji** как лого. Кастомный SVG с gradient fill, 4-pointed concave star.
- **Не использовать AI-vocabulary** — см. таблицу §6. "Powerful", "intelligent", "smart" — запрещено.
- **Не делать spinning wheel-of-eternity** для processing. Sparkle-shimmer animation с прогрессом 0-100.
- **Не показывать LaMa/PyTorch/Python в UI.** Пользователь не должен знать про torch и `~/Library/Application Support/`. Только результаты.
- **Не делать readme.md внутри окна** — есть отдельный About-modal.
