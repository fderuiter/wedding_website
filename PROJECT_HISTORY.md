# Project History

This document contains the original story behind the project and the "next steps" as of the last major update by the original author.

## The Story

Honestly, I started this because [theknot.com](https://theknot.com) felt kinda limiting and, well, a bit bullshit. It's free, sure, but I wanted something that looked cooler, plus it felt like I was selling my soul to the baby of big tech and big wedding... I can't afford the stuff they're tring to sell me, and too keep wedding costs down here we are. I initially got sidetracked thinking about using Three.js to make something visually fancy, but let me tell you, that stuff is *hard*. Got a cool loading heart though. Tried to make some rings fly around eachout and then combine to make a heart, then transition that into the main page, but it ended up looking awful, so I just kept the heart.

I ended up just vibe-coding my way through this and built a whole registry system instead, which turned out pretty slick. It even has a web scraper to help add items quickly from other sites.

**Tech Journey:** Started with storing registry data in a simple JSON file, then migrated to using Prisma with a SQLite database for local development. For deployment on Vercel, the database was migrated again to PostgreSQL, hosted on [Neon](https://neon.tech/), to leverage their serverless capabilities. The old SQLite migration script and database file might still be lurking in the repo, remnants of a bygone era. Enjoy the claimed costco energy drink item test data that might still be in the history somewhere.

## Next steps

Deployed! Right now it's live at: <https://abbifred.com>. Migrated the db to PostgreSQL using Neon, which added the `@neondatabase/serverless` package and required updating Prisma configuration and connection strings. Fixed some wonky issues with the routes during deployment. Set up issue templates and contribution guidelines. Need to verify the registry system thoroughly post-migration. Maybe I'll fix up all the tests for fun. General bug fixes. Maybe I'll put this on my linkedIn? Just kidding, I don't want to be unemployed...
