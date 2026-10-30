/* English catalog (en-GB). The `Messages` type (French) enforces the same keys:
 * any FR key missing here is a TypeScript error. */
import type { Messages } from "../fr";
import common from "./common.json";
import errors from "./errors.json";
import validation from "./validation.json";
import audit from "./audit.json";
import auth from "./auth.json";
import layout from "./layout.json";
import home from "./home.json";
import publicNs from "./public.json";
import taskForm from "./taskForm.json";
import planning from "./planning.json";
import tasks from "./tasks.json";
import projects from "./projects.json";
import users from "./users.json";
import profile from "./profile.json";
import roles from "./roles.json";
import stats from "./stats.json";
import exports from "./exports.json";
import exportFiles from "./exportFiles.json";
import settings from "./settings.json";
import emails from "./emails.json";
import notifications from "./notifications.json";
import admin from "./admin.json";
import apiDocs from "./apiDocs.json";
import mcp from "./mcp.json";
import mcpTools from "./mcpTools.json";
import resources from "./resources.json";
import ui from "./ui.json";
import aiChat from "./aiChat.json";
import version from "./version.json";
import seed from "./seed.json";

const messages: Messages = {
  common,
  errors,
  validation,
  audit,
  auth,
  layout,
  home,
  public: publicNs,
  taskForm,
  planning,
  tasks,
  projects,
  users,
  profile,
  roles,
  stats,
  exports,
  exportFiles,
  settings,
  emails,
  notifications,
  admin,
  apiDocs,
  mcp,
  mcpTools,
  resources,
  ui,
  aiChat,
  version,
  seed,
};

export default messages;
