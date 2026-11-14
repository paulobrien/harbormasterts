# Android device check

Browser emulation covers the automated flows, but does not prove behaviour on physical Android hardware. Test a phone and the intended tablet when available. Record the device, Android and browser versions, orientation, build revision, and results; do not put original game files, private site addresses or credentials in Git.

1. Load the site online, add the authorized game files if needed, and install it from the browser. Close the browser and reopen the installed app.
2. In landscape and portrait, check that the entire harbor and important controls remain visible and usable. Draw and replace routes with a finger; test simultaneous touches and cancelling a gesture.
3. Deliver several boats, send empty boats out to sea, and check that collision, docking, score, and sound are understandable. Compare movement, touch sampling, docking, pacing, warnings and audio against the original where a recording or running original is available.
4. Pause, change settings, resume, and switch to another app. The shift should pause while hidden and remain paused until explicitly resumed. Close and reopen the app and continue the saved shift.
5. After the app and game files have loaded online, enable airplane mode, close and reopen the installed app, and continue playing. Restore connectivity and check an app update without clearing site data.
6. Check the file picker, error messages, keyboard/focus behaviour where a keyboard is available, and that a rejected replacement leaves the previous game and shift available.

Record failures with steps and, where useful, a screenshot or short recording. The automated tests use synthetic assets, so real-file and physical-device results should be reported separately.
