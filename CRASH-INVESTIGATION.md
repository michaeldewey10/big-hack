# Big Hack text-layout crash

## Confirmed cause

The Windows crash report `0xc0000409 / FAST_FAIL_FATAL_APP_EXIT` was the final abort of a Rust panic during a Windows UI callback. The original failing operation was a UTF-8 string slice inside GPUI 0.2.2's Windows DirectWrite layout implementation, at `direct_write.rs:595`.

Captured stderr from the original app reproduced:

```
end byte index 22 is not a char boundary;
it is inside '·' (bytes 21..23 of string)
```

The minidump stack includes `ucrtbase!abort`, `panic_unwind::imp::throw_exception`, `core::str::slice_error_fail`, GPUI `DirectWriteTextSystem::layout_line`, text shaping and the window draw callback. The C runtime module is where the process terminated; it is not evidence that ucrtbase.dll itself is defective.

GPUI's measured-text closure keeps a mutable text-run list. Its ellipsis truncation shortens that list; a later measurement can use the original text with the shortened run. If the old run length lands inside a multibyte character, DirectWrite's Rust wrapper slices at that invalid byte boundary and panics. The standalone regression example reproduces this sequence through the installed GPUI APIs without attaching to the game.

## Change

The two `text_ellipsis()` uses in Big Hack (party state/carrying subtitle and item names) now use `overflow_hidden().whitespace_nowrap()`. Text remains intact for shaping; its containing element clips the rendered line. Unicode names and labels are retained.

Panic logging now records the original panic and a backtrace under `%LOCALAPPDATA%\BigHack\logs\BigHack-<pid>.log`. Release builds retain debug symbols, with the matching PDB saved in `target/release/big_hack.pdb`.

## Verification

`cargo run --release --example text_layout_regression` created a hidden Windows text context, reproduced the original invalid-boundary panic inside a catch_unwind, and then completed **500** intact Unicode text measurements, including middle dots, accented Latin, CJK, and emoji. Its exit code was zero. The caught panic printed during that test is intentional.

The Rust model checks also pass. No pickup or teleport commands were needed. The user will test the rebuilt app's live navigation; this regression does not establish that every UI path is free of other defects.

Detailed debugger output is saved in the workspace at `work/crash-analysis/BigHack-39860.txt`; original symbols and executable are preserved under `work/crash-analysis/original`.
