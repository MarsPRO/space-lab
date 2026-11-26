# Space Lab

[![npm version](https://img.shields.io/npm/v/@marspro/space-lab?logo=npm&logoColor=white)](https://www.npmjs.com/package/@marspro/space-lab)
[![npm downloads](https://img.shields.io/npm/dm/@marspro/space-lab)](https://www.npmjs.com/package/@marspro/space-lab)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/MarsPRO/space-lab/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024%20%7C%2026-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18%20%7C%2019-087EA4?logo=react&logoColor=white)](https://react.dev/)
[![MDX](https://img.shields.io/badge/MDX-supported-FCB32C?logo=mdx&logoColor=white)](https://mdxjs.com/)

**Space Lab** — движок для создания документации,
каталогов компонентов и интерактивных примеров.

Объединяет Markdown, MDX, React и HTML/CSS/JavaScript
в единой среде для документирования проектов
и демонстрации их возможностей.

## Возможности

- Документация на Markdown и MDX.
- Каталоги компонентов.
- Интерактивные примеры.
- Поддержка React и HTML/CSS/JavaScript.
- Поиск по документации.
- Локализация.
- Темы оформления.
- Локальный сервер разработки.
- Статическая сборка.

## Системные требования

| Компонент | Поддерживаемые версии |
| --- | --- |
| Node.js | 22.12.0+ (22.x), 24.x, 26.x |
| npm | 10.x и выше |
| React | 18.3.1+ (18.x), 19.x |
| React DOM | 18.3.1+ (18.x), 19.x |

## Установка

Space Lab подключается к существующему проекту
как зависимость для разработки.

Выполните команду в корневом каталоге проекта:

```sh
npm install --save-dev @marspro/space-lab
```

## Быстрый старт

### 1. Конфигурация

Скопируйте готовый шаблон из установленного пакета в корень проекта:

```sh
node -e "const fs = require('node:fs'); fs.copyFileSync('node_modules/@marspro/space-lab/templates/space-lab.config.mjs', 'space-lab.config.mjs', fs.constants.COPYFILE_EXCL)"
```

Команда сохраняет существующую конфигурацию: если файл уже есть, копирование завершится ошибкой без его перезаписи.

Содержимое `space-lab.config.mjs`:

```js
import { defineConfig } from '@marspro/space-lab';

export default defineConfig({
  name: 'My Project',
  version: '1.0.0',
  content: ['docs/**/*.{md,mdx}'],
});
```

### 2. Создание документации

Создайте файл `docs/index.md`:

```md
# Начало работы

Добро пожаловать в документацию проекта.
```

Минимальная структура проекта:

```text
project/
├── docs/
│   └── index.md
├── package.json
└── space-lab.config.mjs
```

### 3. Запуск

Запустите локальный сервер:

```sh
npx space-lab dev
```

По умолчанию документация доступна по адресу:
[http://127.0.0.1:6006/](http://127.0.0.1:6006/).

## Статическая сборка

Для создания статической версии документации выполните:

```sh
npx space-lab build --output-dir docs-site
```

Результат сборки будет размещён в каталоге `docs-site/`.

## Интерфейс командной строки (CLI)

| Команда | Описание |
| --- | --- |
| `npx space-lab dev` | Запуск локального сервера |
| `npx space-lab build` | Статическая сборка |
| `npx space-lab --version` | Просмотр установленной версии |
| `npx space-lab --help` | Справка по доступным командам |

## Лицензия

Space Lab — программное обеспечение с открытым исходным кодом,
распространяемое под лицензией [MIT](https://github.com/MarsPRO/space-lab/blob/main/LICENSE).
