import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        red: {
          500: "#FD1D1D", // Your brand color
        },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "bounce-once": "bounce 1s ease-in-out 1",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      fontSize: {
        // 15px for message text
        message: "15px",
      },
      fontFamily: {
        // Inter as the default sans stack
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        // Utility for logo text
        logo: ["Pacifico", "cursive"],
      },
      lineHeight: {
        // industry-standard-ish tokens
        body: "1.5", // default reading line-height (16px -> 24px)
        message: "1.375", // compact paragraphs/bubbles
        heading: "1.25", // H1–H3
        title: "1.2", // display/hero
        ui: "1.4", // buttons, form inputs, labels
        code: "1.5", // code blocks / monospace
      },
    },
  },
  plugins: [],
};
