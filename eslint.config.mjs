import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "react/forbid-elements": [
        "error",
        { forbid: ["button", "input", "label"] }
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message: "Features should only be imported via their public index.ts exported interfaces to prevent cross-domain leakage."
            }
          ]
        }
      ]
    }
  }
];

export default eslintConfig;
