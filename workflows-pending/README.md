# Workflows waiting to be activated

These could not be pushed because the GitHub token lacked the `workflow` scope. To activate:

    gh auth refresh -s workflow          # one-time, in a browser
    mkdir -p .github/workflows && cp workflows-pending/*.yml .github/workflows/
    git add .github && git commit -m "Add workflows" && git push

* `site.yml`   - builds and deploys GitHub Pages; daily Gemini blog post (needs secret LLM_API_KEY, vars SITE_URL / API_BASE / CUSTOM_DOMAIN)
* `worker.yml` - deploys the Cloudflare Worker order API (needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
