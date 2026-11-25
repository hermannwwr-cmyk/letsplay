# Setting up the family room on Cloudflare

This puts a tiny free "room keeper" program on the internet. It passes bus positions, colours, numbers and
honks between the devices in a family room. No names are sent and nothing is saved.

Time: about 10–15 minutes. A computer is easiest (copying and pasting code on an iPad works, but is fiddly).
Cloudflare changes its screens now and then, so a button may have a slightly different name. If something
doesn't match, stop and tell Claude what you see.

---

## Part A: Make a free Cloudflare account

1. Open **https://dash.cloudflare.com/sign-up** in a web browser.
2. Type your email address and choose a password. Click **Sign up**.
3. Cloudflare sends you an email. Open it and click the link to **verify your email**.
4. You're now in the Cloudflare dashboard. If it asks what you want to do, or offers to add a website or
   domain, skip it (look for **Skip**, **Maybe later** or the Cloudflare logo to go to the home page).
   You don't need a website or a domain.
5. If it asks you to pick a plan, choose **Free**. Never enter card details; nothing here needs paying.

## Part B: Create the room keeper (a "Worker")

1. In the menu on the left, click **Compute (Workers)**, then **Workers & Pages**.
   (On a narrow screen, tap the ☰ menu button first to see the left menu.)
2. Click the blue **Create** button (or **Create application**).
3. Choose **Start with Hello World!** (it may be called **Create Worker**). Click **Get started** if asked.
4. You'll see a box with a name like `small-river-1234`. Delete it and type exactly:

   **bus-captain-rooms**

5. Click **Deploy** (bottom right). Wait a few seconds until it says your Worker is deployed.
6. If Cloudflare asks you to choose your free **workers.dev subdomain** (a name for your address, for example
   your family name), type any name you like and confirm. It becomes part of the address.

## Part C: Paste in the program

1. On the "deployed" page, click **Edit code** (or **Continue to project**, then **Edit code** at the top
   right).
2. A code editor opens. On the left is a file called `worker.js` (or `index.js`) with a few lines of
   "Hello World" code.
3. Click inside the code, select all of it (**Ctrl+A** on Windows, **⌘+A** on Mac; on an iPad, press and
   hold, then **Select All**), and press **Delete**, so the editor is empty.
4. Open the file **worker.js** that Claude sent you. Select all of its text and copy it (**Ctrl+C** / **⌘+C**,
   or **Copy** on an iPad).
5. Click in the empty editor and paste (**Ctrl+V** / **⌘+V**, or **Paste**).
   The first line should start with `// Little Bus Captain family-room relay` and the last line should be `}`.
6. Click **Deploy** (top right). If it asks to confirm, click **Save and deploy**.
   It may show a warning that `ROOMS` is missing; that's expected and is fixed in Part D.
7. Click the back arrow or the Worker's name (**bus-captain-rooms**) at the top left to leave the editor.

## Part D: Give it its "rooms"

1. On the **bus-captain-rooms** page, click the **Settings** tab (along the top).
2. Find the **Bindings** section and click **Add** (or **Add binding**).
3. In the list, choose **Durable Object** and click **Add binding** / **Next**.
4. Fill in:
   - **Variable name:** `ROOMS` (capital letters, exactly like this)
   - **Durable Object class:** pick **Room** from the list (it comes from the program you pasted).
     If it asks which Worker the class is in, choose **bus-captain-rooms**.
5. Click **Add binding** or **Deploy**. If it asks to confirm a "migration", say yes and deploy.

If **Room** doesn't appear in the list, or you see an error, stop here and tell Claude exactly what the screen
says.

## Part E: Check it works

1. Click the **Overview** tab (or go back to **Workers & Pages** and click **bus-captain-rooms**).
2. Find the address under **Domains & Routes** (or **Preview**). It looks like:

   **https://bus-captain-rooms.YOURNAME.workers.dev**

3. Copy that address, paste it into a new browser tab, add **/health** to the end, and press Enter:

   https://bus-captain-rooms.YOURNAME.workers.dev/health

4. The page should show just the word **ok**.
5. Send that address (without /health) to Claude. It isn't a secret. Claude puts it in the game and tests it.

---

### Good to know
- The Free plan is plenty for a family. If you ever use far too much, Cloudflare simply pauses it for the day;
  it never charges you on the Free plan.
- To turn the family room off: **Workers & Pages** → **bus-captain-rooms** → **Settings** → **Delete**.
  The game keeps working on its own; only playing together stops.
