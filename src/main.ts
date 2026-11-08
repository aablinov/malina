import { wantsEditor, wantsGame } from './devflag.ts';
import { runPlayground } from './dev/playground.ts';
import { runEditor } from './dev/editor.ts';
import { runMenu } from './menu/menu.ts';
import { battleProfile } from './menu/boot.ts';

// Entry point: the main menu (page without parameters), the game (?map=…, ?dev=playground) or the level editor (?dev=editor, F10).
// The build is a single file, so all modules are in it, but only the needed one starts.
// The camp and the battle start after the hero is loaded from the server (src/menu/boot.ts).
if (wantsEditor()) runEditor();
else if (wantsGame()) void battleProfile().then(runPlayground);
else void runMenu();
