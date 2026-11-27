(function () {
  "use strict";

  var params = new URLSearchParams(location.search);

  function clean(value, max) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  var name = clean(params.get("ch"), 120);
  var id = clean(params.get("id"), 64);
  var kind = params.get("kind") === "channel" ? "channel"
    : params.get("kind") === "shorts" ? "shorts" : "video";

  var channelNode = document.getElementById("channel");
  if (name) {
    channelNode.textContent = name;
    document.title = "Blocked: " + name;
  } else {
    channelNode.textContent = "A blocked channel";
  }

  var lede = document.querySelector(".blocked .lede");
  if (lede) {
    lede.innerHTML = "";
    var strong = document.createElement("strong");
    if (kind === "shorts") {
      lede.appendChild(document.createTextNode("Shorts are hidden by your YouTube behavior settings, so this page was not opened."));
    } else {
      strong.textContent = name || "A blocked channel";
      lede.appendChild(strong);
      lede.appendChild(document.createTextNode(kind === "channel"
        ? " is on your blocked list, so the channel page was blocked."
        : " is on your blocked list, so the video was not played."));
    }
  }

  if (id) {
    var meta = document.getElementById("meta");
    meta.textContent = "Channel ID " + id;
    meta.hidden = false;
  }

  document.getElementById("back").addEventListener("click", function () {
    if (history.length > 1) history.back();
    else location.replace("https://www.youtube.com/");
  });
})();
