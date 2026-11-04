import { defineHandler } from 'void'

export const GET = defineHandler(c =>
  c.text('favicon-resolver\n\nGET /<hostname>  e.g. /github.com\n\n404 means no icon was found.\n')
)
