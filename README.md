# Polly API → Postman Builder (Create‑Only)

Automates turning the Polly OpenAPI spec into a fresh, **dated** Postman collection and uploads it to your workspace.

### Why – Manual work creating a Postman collection from our OpenAPI spec
* Import collection with specific import settings (e.g., Tag)
* Manually create authentication folder, auth call, and test script
* Set up environment variables with consistent keys
* Add `{{accessToken}}` to each endpoint’s OAuth2 token field

➡️ **This script automates all of that — one command rebuilds, names, and uploads the full collection to Postman.**

---

## 0) Prereqs

* Node.js 16+ (18+ recommended)
* Postman (desktop app)

---

## 1) Project setup

```bash
mkdir -p postman-builder && cd postman-builder
npm init -y
npm i openapi-to-postmanv2 node-fetch@2 dotenv
```

Create **env.local** in the project root (do **not** commit this file):

```
SPEC_URL=https://docs.polly.io/openapi/polly-api-1.json
POSTMAN_API_KEY=<your_postman_api_key>
POSTMAN_WORKSPACE_ID=ca4b69c0-6e8f-4566-8561-075f5d7d6a7b
```

Add to **.gitignore**:

```
env.local
```

---

## 2) Script

Place the **create‑only** `build-postman.js` in this folder (the version that:

* adds **Auth → Get Access Token** using `{{username}}/{{password}}/{{clientId}}/{{clientSecret}}`
* keeps each endpoint as OAuth2 from the Swagger import and sets `{{accessToken}}` in each endpoint’s token field
* strips hardcoded Authorization headers so each request’s auth config drives the header
* removes collection `baseUrl` var so Environment value is used
* **always POSTs** a new collection named `Polly API YYYY-MM-DD`
  )

---

## 3) package.json helper (optional but recommended)

Add a script for easy runs:

```json
"scripts": {
  "rebuild": "node build-postman.js"
}
```

---

## 4) Run it

**Recommended:**

```bash
npm run rebuild
```

**Or:**

```bash
node build-postman.js
```

Output:

```
Wrote ./Polly.postman_collection.json
✅ Collection created: {...}
```

What happens:

* Converts the OpenAPI at `SPEC_URL`
* Generates a collection named **Polly API YYYY-MM-DD**
* Uploads it to workspace **POSTMAN_WORKSPACE_ID**

---

## 5) In Postman

1. Select the **🟢 STAGE - Default** environment.
2. Fill these env vars:

```
baseUrl      https://api.stage.polly.io
username     <your_username>
password     <your_password>
clientId     <your_clientId>
clientSecret <your_clientSecret>
```

3. Run **Auth → Get Access Token** → populates `accessToken`/`refreshToken` in your environment.
4. Send any request — each endpoint uses OAuth2 with `{{accessToken}}` in the token field, so Postman sends the token from your environment.

---

## 6) Maintenance

* Re-run `npm run rebuild` anytime to generate a **new dated** collection from the current spec.

---

## 7) Caveats

* Some Postman UI import toggles (optional params, nested tags, inherit auth) aren’t exposed in the converter API. If optional params appear, uncheck them once in the UI.
* This is **create-only**; every run POSTs a new collection. (No update/merge.)
* Keep secrets in **env.local** only; don’t commit it.
