/**
 * Encoded images the client tests share.
 *
 * A JPEG is the format kitty cannot transmit as-is, so every test that proves
 * the PNG conversion needs one; carrying the bytes here keeps each test's own
 * fixture block about the thing it actually asserts.
 *
 * @module hulala-cli/tests/client/imageFixtures
 */

/** An 8×4 JPEG encoded by photon from eight flat rows of colour. */
export const JPEG_BASE64 = '/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAAEAAgDAREAAhEBAxEB/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCDWYI9Hh0vT9MT7NE0sdhvjJDLG0YdivZWbdgkDoB9avBv69h5Tr68rl0VvdqKmrq1tpN22vfS0pKWFSKjhqdJbVVOUvPlaio3/l1u112vytp//9k='

/** The fixture's encoded bytes, as the attachment store would return them. */
export const JPEG_BYTES = Uint8Array.from(Buffer.from(JPEG_BASE64, 'base64'))
