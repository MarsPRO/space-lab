# Space Lab

Движок документации и интерактивных примеров на Markdown/MDX, React и HTML/CSS/JavaScript. Поиск, локализация, темы и статическая сборка.

## Установка

Node.js 22 (от 22.12), 24 или 26; npm 10+; React/React DOM 18.3.1 или 19.

```sh
npm install -D @marspro/space-lab
```

## Быстрый старт

Создайте `space-lab.config.mjs` в своём проекте:

```js
import { defineConfig } from '@marspro/space-lab';

export default defineConfig({
  name: 'Мой проект',
  version: '1.0.0',
  content: ['docs/**/*.{md,mdx}'],
});
```

Добавьте `docs/index.md` с текстом `# Начало работы` и запустите:

```sh
npx space-lab dev
```

Сайт: <http://127.0.0.1:6006/>. Статическая сборка: `npx space-lab build --output-dir docs-site`.

## Разработка пакета

Node.js 24. Команды из корня репозитория:

```sh
npm ci
npm run lint
npm run typecheck
npm run build
```

Лицензия — [MIT](LICENSE).
