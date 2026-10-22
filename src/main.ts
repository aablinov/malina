import { wantsEditor, wantsPlayground } from './devflag';
import { runGame } from './game';
import { runPlayground } from './dev/playground';
import { runEditor } from './dev/editor';

// Точка входа: обычная игра, плейграунд разработчика (?dev=playground, F9 в меню) или редактор уровней (?dev=editor, F10).
// Сборка — один файл, поэтому оба модуля в нём, а запускается только нужный.
if (wantsPlayground()) runPlayground();
else if (wantsEditor()) runEditor();
else runGame();
