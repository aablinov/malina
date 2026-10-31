import { wantsEditor, wantsGame } from './devflag';
import { runPlayground } from './dev/playground';
import { runEditor } from './dev/editor';
import { runMenu } from './menu/menu';

// Точка входа: главное меню (страница без параметров), игра (?map=…, ?dev=playground) или редактор уровней (?dev=editor, F10).
// Сборка — один файл, поэтому все модули в нём, а запускается только нужный.
if (wantsEditor()) runEditor();
else if (wantsGame()) runPlayground();
else runMenu();
