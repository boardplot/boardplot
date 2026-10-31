### Fixed

- The Maps example now works in a Next.js app router page. It keeps the pack import and the chart in one `"use client"` module. Before, a bare pack import in a server file registered the pack in the server layer, and the chart read an empty registry and threw `geo-pack-duplicate-install`. The reference now says this, and the message of that error names the server and client layer case first, before it advises to de-duplicate the install.
