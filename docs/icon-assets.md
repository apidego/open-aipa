# Service icons

Assets are served locally from `web/assets/icons`; rendering does not contact third-party servers.

- `gmail.svg`: unmodified Gmail product icon linked by [Google Workspace Gmail](https://workspace.google.com/products/gmail/). Downloaded from [Google's asset server](https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web/192px.svg) on 2026-11-11.
- `discord.svg`: unmodified Blurple Clyde symbol from [Discord's official brand page](https://discord.com/branding). Downloaded from its [linked SVG](https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d80db9971f10a9757c99_Symbol.svg) on 2026-11-11. Gmail and Discord marks remain the property of their respective owners.
- `open-aipa.svg`: project-owned mark using the existing two rounded strokes at 24 degrees, both solid black on a transparent canvas. `open-aipa.png` is a transparent 256×256 export.

`ServiceIcon` shares these assets between integration cards, the Gmail dashboard teaser, and task destinations. Only approved dashboard/Discord destinations appear in the task row; Gmail is available as an asset and integration icon, not as a notification channel. Accessible image names and hover titles identify each destination. Discord recipient approval remains in the activation dialog.
