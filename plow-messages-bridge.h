// `NSUnarchiver` signals a malformed typedstream by RAISING, not returning
// nil; Swift has no `@catch`, so an uncaught NSException would abort the
// process. A message body is attacker-supplied, so a malformed blob must
// cost one row, not every query. `static inline` in a bridging header
// compiles into the same binary, giving Swift an ObjC `@try`.

#import <Foundation/Foundation.h>

/// Decode a typedstream blob, or nil if malformed in any way, including the
/// ways that raise rather than return.
///
/// Residual, accepted knowingly: legacy `NSUnarchiver` has no class
/// allowlist, so a crafted blob can name a class and run its
/// `initWithCoder:`. The `@try` bounds the crash, not that; casting the
/// result only to `NSAttributedString`/`NSString`, plus the seatbelt sandbox, bound the rest.
static inline id PlowMessagesUnarchive(NSData *data) {
    @try {
        return [NSUnarchiver unarchiveObjectWithData:data];
    } @catch (NSException *exception) {
        // Swallowed: the reason string embeds untrusted blob bytes.
        return nil;
    }
}
