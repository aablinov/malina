import { wantsEditor } from './devflag';
import { runPlayground } from './dev/playground';
import { runEditor } from './dev/editor';

// Точка входа: плейграунд (основная сцена) или редактор уровней (?dev=editor, F10).
// Сборка — один файл, поэтому оба модуля в нём, а запускается только нужный.
if (wantsEditor()) runEditor();
else runPlayground();
