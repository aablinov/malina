import { wantsPlayground } from './devflag';
import { runGame } from './game';
import { runPlayground } from './dev/playground';

// Точка входа: обычная игра или плейграунд разработчика (?dev=playground, F9 в меню).
// Сборка — один файл, поэтому оба модуля в нём, а запускается только нужный.
if (wantsPlayground()) runPlayground();
else runGame();
