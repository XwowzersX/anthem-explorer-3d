Routes

TanStack Start uses file-based routing. Every .tsx file in this directory is a route. Do not create src/pages/, src/routes/_app/index.tsx, or app/layout.tsx — those are Next.js / Remix conventions. The only root layout is src/routes/__root.tsx.
Conventions
File 	URL
index.tsx 	/
about.tsx 	/about
users/index.tsx 	/users
users/$id.tsx 	/users/:id (dynamic — bare $, no curly braces)
posts/{-$category}.tsx 	/posts/:category? (optional segment)
files/$.tsx 	/files/* (splat — read via _splat param, never *)
_layout.tsx 	layout route (renders children via <Outlet />)
__root.tsx 	app shell — wraps every page; preserve <Outlet />

routeTree.gen.ts is auto-generated. Don't edit it by hand.

TO RUN THIS CODE:

open command prompt (have node.js installed)

navigate to project main folder, and copy file path. Then run CD (File path) Example: cd C:/Peter/anthem-explorer-3d

enter the command: npm install
Then run: npm run dev
