import { defineCommand } from "citty";

import {
  addAccount,
  listAccounts,
  readTokenFromStdin,
  removeAccount,
  resolveAccountToken,
  verifyToken,
} from "@/auth";
import { runOrExit } from "@/errors";
import { printSuccess } from "@/output";

export const authCommand = defineCommand({
  meta: { name: "auth", description: "Manage accounts" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Add a named account" },
      args: {
        name: {
          type: "positional",
          description: "Account name",
          required: true,
        },
      },
      run: runOrExit(async ({ args }) => {
        const token = await readTokenFromStdin();
        addAccount(args.name, token);
        printSuccess("auth.add", { account: args.name, added: true });
      }),
    }),
    list: defineCommand({
      meta: { name: "list", description: "List stored accounts" },
      run: runOrExit(() => {
        printSuccess("auth.list", { accounts: listAccounts() });
      }),
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove an account" },
      args: {
        name: {
          type: "positional",
          description: "Account name",
          required: true,
        },
      },
      run: runOrExit(({ args }) => {
        removeAccount(args.name);
        printSuccess("auth.remove", { account: args.name, removed: true });
      }),
    }),
    status: defineCommand({
      meta: { name: "status", description: "Check token validity" },
      args: {
        account: { type: "string", description: "Named account" },
      },
      run: runOrExit(async ({ args }) => {
        const token = resolveAccountToken(args.account);
        const result = await verifyToken(token);
        printSuccess("auth.status", result);
      }),
    }),
  },
});
