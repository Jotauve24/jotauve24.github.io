(() => {
    const header = document.querySelector(".site-header");
    const menuToggle = document.querySelector(".menu-toggle");
    const mainNav = document.querySelector("#main-nav");
    const backToTop = document.querySelector(".back-to-top");
    const readingProgress = document.querySelector("#reading-progress-fill");
    const year = document.querySelector("#current-year");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (menuToggle && mainNav) document.documentElement.classList.add("js-menu");

    if (year) year.textContent = new Date().getFullYear();

    const setMenuOpen = (open) => {
        if (!menuToggle || !mainNav) return;
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
        mainNav.classList.toggle("is-open", open);
    };

    menuToggle?.addEventListener("click", () => {
        const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
        setMenuOpen(!isOpen);
    });

    mainNav?.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", () => setMenuOpen(false));
    });

    const projectFilters = [...document.querySelectorAll("[data-project-filter]")];
    const projectCards = [...document.querySelectorAll(".project-grid [data-category]")];
    const projectCount = document.querySelector("#project-count");

    if (projectFilters.length && projectCards.length) {
        projectFilters.forEach((button) => {
            button.addEventListener("click", () => {
                const category = button.dataset.projectFilter;
                let visibleCount = 0;

                projectFilters.forEach((filter) => {
                    const isActive = filter === button;
                    filter.classList.toggle("is-active", isActive);
                    filter.setAttribute("aria-pressed", String(isActive));
                });

                projectCards.forEach((card) => {
                    const isVisible = category === "all" || card.dataset.category === category;
                    card.hidden = !isVisible;
                    card.classList.remove("filter-enter");

                    if (isVisible) {
                        visibleCount += 1;
                        if (!reduceMotion) {
                            requestAnimationFrame(() => card.classList.add("filter-enter"));
                        }
                    }
                });

                if (projectCount) {
                    projectCount.textContent = `${visibleCount} ${visibleCount === 1 ? "proyecto" : "proyectos"}`;
                }
            });
        });

        projectCards.forEach((card) => {
            card.addEventListener("animationend", (event) => {
                if (event.target === card && event.animationName === "filter-card-in") {
                    card.classList.remove("filter-enter");
                }
            });
        });

        document.documentElement.classList.add("js-project-filters");
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
            setMenuOpen(false);
            menuToggle.focus();
        }
    });

    document.addEventListener("click", (event) => {
        if (
            menuToggle?.getAttribute("aria-expanded") === "true" &&
            !event.target.closest(".site-header")
        ) {
            setMenuOpen(false);
        }
    });

    const updateScrollDecorations = () => {
        const scrolled = window.scrollY > 12;
        header?.classList.toggle("is-scrolled", scrolled);
        backToTop?.classList.toggle("is-visible", window.scrollY > 500);
        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollableHeight > 0
            ? Math.min(Math.max(window.scrollY / scrollableHeight, 0), 1)
            : 0;
        readingProgress?.style.setProperty("transform", `scaleX(${progress})`);
    };

    updateScrollDecorations();
    let scrollUpdatePending = false;
    window.addEventListener("scroll", () => {
        if (scrollUpdatePending) return;
        scrollUpdatePending = true;
        window.requestAnimationFrame(() => {
            updateScrollDecorations();
            scrollUpdatePending = false;
        });
    }, { passive: true });
    window.addEventListener("resize", updateScrollDecorations, { passive: true });

    if ("IntersectionObserver" in window) {
        const navLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
        const sections = document.querySelectorAll("main section[id]");
        const activeSectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                navLinks.forEach((link) => {
                    if (link.getAttribute("href") === "#" + entry.target.id) {
                        link.setAttribute("aria-current", "location");
                    } else {
                        link.removeAttribute("aria-current");
                    }
                });
            });
        }, { rootMargin: "-30% 0px -60% 0px", threshold: 0 });

        sections.forEach((section) => activeSectionObserver.observe(section));

        const revealItems = document.querySelectorAll("[data-reveal]");
        if (!reduceMotion) {
            document.documentElement.classList.add("has-motion");
            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });
            revealItems.forEach((item) => revealObserver.observe(item));
        } else {
            revealItems.forEach((item) => item.classList.add("is-visible"));
        }
    } else {
        document.querySelectorAll("[data-reveal]").forEach((item) => item.classList.add("is-visible"));
    }
})();
