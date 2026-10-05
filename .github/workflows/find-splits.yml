name: Find splits

on:
  # Только ручной запуск — из вкладки Actions.
  workflow_dispatch:

jobs:
  find:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    permissions:
      contents: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Find splits
        run: python scripts/find_splits.py

      - name: Commit report
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/splits-report.txt
          if git diff --staged --quiet; then
            echo "Отчёт не изменился — коммит не нужен."
          else
            git commit -m "chore(splits): отчёт детектора $(date -u +'%Y-%m-%d')"
            git push
          fi
