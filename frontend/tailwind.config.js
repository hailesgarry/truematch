import defaultTheme from "tailwindcss/defaultTheme";
import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        red: {
          500: "#FD1D1D", // Your brand color
        },
        "chat-bubble": "#E9ECEF",
        "reply-bubble": "#F5F7FA",
      },
      backgroundImage: {
        "primary-gradient":
          "linear-gradient(to right, #e91e8c 0%, #d41f8e 30%, #ca209e 50%, #c820c8 70%, #b521d4 100%)",
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
        message: "0.9375rem",
      },
      fontFamily: {
        // Inter provides a modern, highly legible sans stack for chat UI
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        // Utility for logo text
        logo: ["Pacifico", "cursive"],
      },
      fontWeight: {
        message: "470",
        reply: "470",
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
  plugins: [
    plugin(({ addUtilities, theme }) => {
      const primaryGradient = theme("backgroundImage.primary-gradient");
      addUtilities({
        ".text-primary-gradient": {
          backgroundImage: primaryGradient,
          backgroundRepeat: "no-repeat",
          backgroundSize: "100% 100%",
          color: "transparent",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        },
      });
    }),
  ],
};
