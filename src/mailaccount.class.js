/// <reference path="chrome-api-vsdoc.js" />
/// <reference path="jquery-1.4.2.js" />

/* 
*********************************
MailAccount class
by Anders Sahlin a.k.a. destructoBOT (malakeen@gmail.com)
for Google Mail Checker Plus
https://chrome.google.com/extensions/detail/gffjhibehnempbkeheiccaincokdjbfe
*********************************
*/

String.prototype.htmlEntities = function () {
   return this.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

var baseURL = "http://api.eveonline.com/";
var gateURL = "https://gate.eveonline.com/";

function MailAccount(settingsObj) {
   // Check global settings
   var pollInterval = localStorage["gc_poll"];
   var requestTimeout = 10000;
   var openInTab = (localStorage["gc_open_tabs"] != null && localStorage["gc_open_tabs"] == "true");
   var archiveAsRead = (localStorage["gc_archive_read"] != null && localStorage["gc_archive_read"] == "true");
   var mailURL = baseURL+"char/MailMessages.xml.aspx";
   var charNameURL = baseURL+"eve/CharacterName.xml.aspx";
   var acctID = settingsObj.id;
   var apiKey = settingsObj.key;
   var charID = settingsObj.char;

   var inboxLabel;
   var atomLabel;
   var unreadLabel;

   var mailArray = new Array();
   var newestMail;
   var unreadCount = -1;
   var latestID = localStorage["gc_latest_"+settingsObj.char] || -1;
   var unread = (localStorage["gc_unread_"+settingsObj.char] || "").split(',');
   var mailTitle;
   var abortTimerId;
   var gmailAt = null;
   var errorLives = 5;
   var isStopped = false;
   var requestTimer;

   var lists = {};
   var isUnread = {};
   for (var i in unread)
      isUnread[unread[i]] = 1;

   this.onUpdate;
   this.onError;
   this.isDefault;

   // Debug output (if enabled, might cause memory leaks)
   var verbose = true;

   // Without this/that, no internal calls to onUpdate or onError can be made...
   var that = this;
   
   function onGetInboxSuccess(data) {
      var foundNewMail = false;
      var xmlDocument = $(data);
      var newLatest = xmlDocument.find('row').first().attr('messageID');
      var unread = 0;

      mailTitle = xmlDocument.find('rowset').attr('name');//xmlDocument.find('message').attr("title");
      //newestMail = null;
      var newMailArray = new Array();

      logToConsole("Latest so far was "+latestID+" new latest is "+newLatest);
      if (newLatest > latestID || latestID == -1) {
         // Mail count has been reduced, so we need to reload all mail.
         // TODO: Find the old mail(s) and remove them instead.
         foundNewMail = true;
         mailArray = new Array();
      }

      // Parse xml data for each mail entry
      xmlDocument.find('row').each(function () {
         var title = $(this).attr('title');
//         var summary = $(this).find('summary').text();
         var issued = $(this).attr('sentDate');
         issued = (new Date()).setISO8601(issued);
         var id = $(this).attr('messageID');
         if (id <= latestID && !isUnread[id])
             return;

         var authorID = $(this).attr('senderID');
         if (authorID == settingsObj.char) {	// You are the sender
             var isRecipient = false;
             var recipients = $(this).attr('toCharacterIDs').split(',');
             for (var i in recipients)
                 if (recipients[i] == settingsObj.char) {
                     isRecipient = true;
             break;
         }
         if (!isRecipient)
             return;
     }

	 var authorName;

         $.ajax({
            type: "POST",
            dataType: "text",
            url: charNameURL,
            data: "ids="+authorID,
            async: false,
            timeout: requestTimeout,
            success: function (data) { authorName = $(data).find("row[name]").attr("name"); },
            error: function (xhr, status, err) { handleError(xhr, status, err); }
         });

//       var authorMail = $(this).find('author').find('mail').text();

         // Data checks
         if (authorName == null || authorName.length < 1)
            authorName = "(unknown sender)";
         if (title == null || title.length < 1)
            title = "(No subject)";

         // Construct a new mail object
         var mailObject = {
            "id": id,
            "title": title,
//            "summary": summary,
//            "link": link,
            "issued": issued,
            "authorName": authorName,
//            "authorMail": authorMail
         };

         newMailArray.push(mailObject);
      isUnread[id] = 1;
      });
      latestID = newLatest;
      localStorage["gc_latest_"+settingsObj.char] = latestID;
      
      // Sort new mail by date
      newMailArray.sort(function (a, b) {
         if (a.issued > b.issued)
            return -1;
         if (a.issued < b.issued)
            return 1;
         return 0;
      });

      // See if there is a new mail present
      if (newMailArray.length > 0) {
         newestMail = newMailArray[0];
      }

      // Insert new mail into mail array
      $.each(newMailArray, function (i, newMail) {
         mailArray.push(newMail);
      });

      // Sort all mail by date
      mailArray.sort(function (a, b) {
         if (a.issued > b.issued)
            return -1;
         if (a.issued < b.issued)
            return 1;
         return 0;
      });

      // We've found new mail, alert others!
      if (foundNewMail || unreadCount == -1) {
         handleSuccess(mailArray.length);
      } else {
         logToConsole(mailURL + " - No new mail found.");
      }
   }

   // Handles a successful getInboxCount call and schedules a new one
   function handleSuccess(count) {
      logToConsole("success!");
      window.clearTimeout(abortTimerId);
      errorLives = 5;
      updateUnreadCount(count);
      //scheduleRequest(); 
   }

   // Handles a unsuccessful getInboxCount call and schedules a new one
   function handleError(xhr, text, err) {
      logToConsole("error! " + xhr + " " + text + " " + err);
      window.clearTimeout(abortTimerId);

      if (errorLives > 0)
         errorLives--;

      if (errorLives == 0) {
         errorLives = -1;
         setLoggedOutState();
      }

      //scheduleRequest();
   }

   // Retreives inbox count and populates mail array
   function getInboxCount() {
      try {
         var data = "userID="+acctID+"&apiKey="+apiKey+"&characterID="+charID;
         logToConsole("requesting " + mailURL+ " with data ["+data+"]");

         $.ajax({
            type: "POST",
            dataType: "text",
            url: mailURL,
            data: data,
            timeout: requestTimeout,
            success: function (data) { onGetInboxSuccess(data); },
            error: function (xhr, status, err) { handleError(xhr, status, err); }
         });

         if (gmailAt == null) {
            getAt();
         }
      } catch (e) {
         console.error("exception: " + e);
         handleError();
      }
   }

   // Schedules a new getInboxCount call
   function scheduleRequest(interval) {
      if (isStopped) {
         return;
      }

      logToConsole("scheduling new request");

      if (interval != null) {
         window.setTimeout(getInboxCount, interval);
      } else {
         requestTimer = window.setTimeout(getInboxCount, pollInterval);
         window.setTimeout(scheduleRequest, pollInterval);
      }
   }

   // Updates unread count and calls onUpdate event
   function updateUnreadCount(count) {
      if (unreadCount != count) {
         unreadCount = count;
         logToConsole("unread count: " + unreadCount);

         if (that.onUpdate != null) {
            try {
               logToConsole("trying to call onUpdate...");
               that.onUpdate(that);
            }
            catch (e) {
               console.error(e);
            }
         }
      }
   }

   // Calls onError and resets data
   function setLoggedOutState() {
      if (that.onError != null) {
         try {
            logToConsole("trying to call onError...");
            that.onError(that);
         }
         catch (e) {
            console.error(e);
         }
      }

      unreadCount = -1;
      mailArray = new Array();
   }

   function logToConsole(text) {
      if (verbose)
         console.log(text);
   }

   // Send a POST action to Gmail
   function postAction(postObj) {
      if (gmailAt == null) {
         getAt(postAction, postObj);
      } else {
         var threadid = postObj.threadid;
         var action = postObj.action;

         var postURL = mailURL;
         var postParams = "";

         logToConsole(postURL);
         logToConsole(postParams);

         var postXHR = new XMLHttpRequest();
         postXHR.onreadystatechange = function () {
            if (this.readyState == 4 && this.status == 200) {
               // Post successful! Refresh once
               window.setTimeout(getInboxCount, 0);
            } else if (this.readyState == 4 && this.status == 401) {

            }
         }
         postXHR.onerror = function (error) {
            logToConsole("mark as read error: " + error);
         }

         postXHR.open("POST", postURL, true);
         postXHR.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
         postXHR.send(postParams);
      }
   }

   // Opens the basic HTML version of Gmail and fetches the Gmail_AT value needed for POST's
   function getAt(callback, tag) {
      var getURL = mailURL;
      var gat_xhr = new XMLHttpRequest();
      gat_xhr.onreadystatechange = function () {
         if (this.readyState == 4 && this.status == 200) {
            //logToConsole(this.responseText);
            var matches = this.responseText.match(/\?at=([^"]+)/);
            //logToConsole(matches);
            if (matches != null && matches.length > 0) {
               gmailAt = matches[1];
               //logToConsole(gmailAt);

               if (callback != null) {
                  callback(tag);
               }
            }
         } else if (this.readyState == 4 && this.status == 401) {

         }
      }
      gat_xhr.onerror = function (error) {
         logToConsole("get gmail_at error: " + error);
      }
      gat_xhr.open("GET", getURL, true);
      gat_xhr.send(null);
   }

   /* Public methods */

   // Starts the scheduler
   this.startScheduler = function () {
      logToConsole("starting scheduler...");
      getInboxCount();
      scheduleRequest();
   }

   // Stops the scheduler
   this.stopScheduler = function () {
      logToConsole("stopping scheduler...");
      isStopped = true;

      if (requestTimer != null) {
         window.clearTimeout(requestTimer);
      }

      delete that;
   }
   // Opens the inbox
   this.openInbox = function () {
      // See if there is any Gmail tab open	
      chrome.windows.getAll({ populate: true }, function (windows) {
         for (var w in windows) {
            for (var i in windows[w].tabs) {
               var tab = windows[w].tabs[i];
               if (tab.url.indexOf(mailURL) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               } else if (tab.url.indexOf(mailURL.replace("http:", "https:")) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               } else if (tab.url.indexOf(mailURL.replace("https:", "http:")) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               }
            }
         }
         chrome.tabs.create({ url: gateURL + "Mail/Inbox" });
      });
   }

   // Opens unread label
   this.openUnread = function () {
      // See if there is any Gmail tab open		
      chrome.windows.getAll({ populate: true }, function (windows) {
         for (var w in windows) {
            for (var i in windows[w].tabs) {
               var tab = windows[w].tabs[i];
               if (tab.url.indexOf(mailURL) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               } else if (tab.url.indexOf(mailURL.replace("http:", "https:")) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               } else if (tab.url.indexOf(mailURL.replace("https:", "http:")) >= 0) {
                  chrome.tabs.update(tab.id, { selected: true });
                  return;
               }
            }
         }
         chrome.tabs.create({ url: gateURL + "Mail/Inbox" });
      });
   }

   // Opens a thread
   this.openThread = function (threadid) {
      if (threadid != null) {
         chrome.tabs.create({ url: gateURL + "Mail/ReadMessage/" + threadid });
         postAction({ "threadid": threadid, "action": "rd" });
         scheduleRequest(1000);
      }
   }
   // Fetches content of thread
   this.getThread = function (accountid, threadid, callback) {
      if (threadid != null) {
         var getURL = mailURL.replace('http:', 'https:') + "h/" + Math.ceil(1000000 * Math.random()) + "/?v=pt&th=" + threadid;
         var gt_xhr = new XMLHttpRequest();
         gt_xhr.onreadystatechange = function () {
            if (this.readyState == 4 && this.status == 200) {
//               var markAsRead = (localStorage["gc_showfull_read"] != null && localStorage["gc_showfull_read"] == "true");

//               if(markAsRead)
//                  that.readThread(threadid);

               var matches = this.responseText.match(/<hr>[\s\S]?<table[^>]*>([\s\S]*?)<\/table>(?=[\s\S]?<hr>)/gi);
               //var matches = matchRecursiveRegExp(this.responseText, "<div class=[\"]?msg[\"]?>", "</div>", "gi")
               //logToConsole(this.responseText);
               //logToConsole(matches[matches.length - 1]);
               //logToConsole(matches);
               if (matches != null && matches.length > 0) {
                  var threadbody = matches[matches.length - 1];
                  threadbody = threadbody.replace(/<tr>[\s\S]*?<tr>/, "");
                  threadbody = threadbody.replace(/<td colspan="?2"?>[\s\S]*?<td colspan="?2"?>/, "");
                  threadbody = threadbody.replace(/cellpadding="?12"?/g, "");
                  threadbody = threadbody.replace(/font size="?-1"?/g, 'font');
                  threadbody = threadbody.replace(/<hr>/g, "");
                  threadbody = threadbody.replace(/(href="?)\/mail\//g, "$1" + mailURL);
                  threadbody = threadbody.replace(/(src="?)\/mail\//g, "$1" + mailURL);
                  //threadbody += "<span class=\"lowerright\">[<a href=\"javascript:showReply('" + threadid + "');\" title=\"Write quick reply\">reply</a>]&nbsp;[<a href=\"javascript:hideBody('" + threadid + "');\" title=\"Show summary\">less</a>]</span>";
                  logToConsole(threadbody);
                  if (callback != null) {
                     callback(accountid, threadid, threadbody);
                  }
               }
            } else if (this.readyState == 4 && this.status == 401) {

            }
         }
         gt_xhr.onerror = function (error) {
            logToConsole("get thread error: " + error);
         }
         gt_xhr.open("GET", getURL, true);
         gt_xhr.send(null);
      }
   }

   // Posts a reply to a thread
   this.replyToThread = function (replyObj) {
      if (gmailAt == null) {
         getAt(that.replyToThread, replyObj);
      } else {
         var threadid = replyObj.id;
         var reply = escape(replyObj.body);
         var callback = replyObj.callback;

         var postURL = mailURL;
         var postParams = "";

         logToConsole(postParams);

         var postXHR = new XMLHttpRequest();
         postXHR.onreadystatechange = function () {
            if (this.readyState == 4 && this.status == 200) {
               // Reply successful! Fire callback
               // callback();
            } else if (this.readyState == 4 && this.status == 401) {

            }
         }
         postXHR.onerror = function (error) {
            logToConsole("reply to thread error: " + error);
         }

         postXHR.open("POST", postURL, true);
         postXHR.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
         postXHR.send(postParams);
      }
   }

   // Marks a thread as read
   this.readThread = function (threadid) {
	logToConsole("Marking "+threadid+" as read");
/*
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "rd" });
      }
*/
   }

   // Marks a thread as read
   this.unreadThread = function (threadid) {
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "ur" });
      }
   }

   // Archives a thread
   this.archiveThread = function (threadid) {
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "arch" });
         if (archiveAsRead) {
            postAction({ "threadid": threadid, "action": "rd" });
         }
      }
   }

   // Deletes a thread
   this.deleteThread = function (threadid) {
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "rd" });
         postAction({ "threadid": threadid, "action": "tr" });
      }
   }

   // Deletes a thread
   this.spamThread = function (threadid) {
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "sp" });
      }
   }

   // Stars a thread
   this.starThread = function (threadid) {
      if (threadid != null) {
         postAction({ "threadid": threadid, "action": "st" });
      }
   }

   // Retrieves unread count
   this.getUnreadCount = function () {
      return Number(unreadCount);
   }

   // Returns the "Gmail - Inbox for..." link
   this.getInboxLink = function () {
      if (mailTitle != null && mailTitle != "")
         return mailTitle;
      return mailURL;
   }

   // Returns the mail array
   this.getMail = function () {
      return mailArray;
   }

   // Returns the newest mail
   this.getNewestMail = function () {
      return newestMail;
   }

   // Opens the newest thread
   this.openNewestMail = function () {
      if (newestMail != null) {
         that.openThread(newestMail.id);
      }
   }

   // Reads the newest thread
   this.readNewestMail = function () {
      if (newestMail != null) {
         that.readThread(newestMail.id);
      }
   }

   // Spams the newest thread
   this.spamNewestMail = function () {
      if (newestMail != null) {
         that.spamThread(newestMail.id);
      }
   }

   // Deletes the newest thread
   this.deleteNewestMail = function () {
      if (newestMail != null) {
         that.deleteThread(newestMail.id);
      }
   }

   // Archive the newest thread
   this.archiveNewestMail = function () {
      if (newestMail != null) {
         that.archiveThread(newestMail.id);
      }
   }

   // Returns the mail URL
   this.getURL = function () {
      return mailURL;
   }

   this.getNewAt = function () {
      getAt();
   }

   // Returns the mail array
   this.refreshInbox = function () {
      window.setTimeout(getInboxCount, 0);
   }

   // Opens the Compose window
   this.composeNew = function () {
      if (openInTab) {
         chrome.tabs.create({ url: mailURL + "?view=cm&fs=1&tf=1" });
      } else {
         window.open(mailURL + "?view=cm&fs=1&tf=1", 'Compose new message', 'width=640,height=480');
      }
   }

   // Opens the Compose window and embeds the current page title and URL
   this.sendPage = function (tab) {
      var body = encodeURIComponent(unescape(tab.url));
      var subject = encodeURIComponent(unescape(tab.title));
      subject = subject.replace('%AB', '%2D'); // Special case: escape for %AB
      var urlToOpen = mailURL + "?view=cm&fs=1&tf=1" + "&su=" + subject + "&body=" + body;

      if (openInTab) {
         chrome.tabs.create({ url: urlToOpen });
      } else {
         window.open(urlToOpen, 'Compose new message', 'width=640,height=480');
      }
   }

   // Opens the Compose window with pre-filled data
   this.replyTo = function (mail) {
      //this.getThread(mail.id, replyToCallback);
      var to = encodeURIComponent(mail.authorMail); // Escape sender email
      var subject = mail.title; // Escape subject string
      subject = (subject.search(/^Re: /i) > -1) ? subject : "Re: " + subject; // Add 'Re: ' if not already there
      subject = encodeURIComponent(subject);
      // threadbody = encodeURIComponent(threadbody);
      var issued = mail.issued;
      var threadbody = "\r\n\r\n" + issued.toString() + " <" + mail.authorMail + ">:\r\n" + mail.summary;
      threadbody = encodeURIComponent(threadbody);
      var replyURL = mailURL.replace('http:', 'https:') + "?view=cm&tf=1&to=" + to + "&su=" + subject + "&body=" + threadbody;
      logToConsole(replyURL);
      if (openInTab) {
         chrome.tabs.create({ url: replyURL });
      } else {
         window.open(replyURL, 'Compose new message', 'width=640,height=480');
         //chrome.windows.create({url: replyURL});
      }
   }

   function replyToCallback(threadid, threadbody) {
      var mail;
      for (var i in mailArray) {
         if (mailArray[i].id == threadid) {
            mail = mailArray[i];
            break;
         }
      }

      if (mail == null)
         return;

      var to = encodeURIComponent(mail.authorMail); // Escape sender email
      var subject = mail.title; // Escape subject string
      subject = (subject.search(/^Re: /i) > -1) ? subject : "Re: " + subject; // Add 'Re: ' if not already there
      subject = encodeURIComponent(subject);
      threadbody = encodeURIComponent(threadbody);
      var replyURL = mailURL + "?view=cm&fs=1&tf=1&to=" + to + "&su=" + subject + "&body=" + mail.summary;
      if (openInTab) {
         chrome.tabs.create({ url: replyURL });
      } else {
         window.open(replyURL, 'Compose new message', 'width=640,height=480');
         //chrome.windows.create({url: replyURL});
      }
   }

   // No idea, actually...
   function NSResolver(prefix) {
      if (prefix == 'gmail') {
         return 'http://purl.org/atom/ns#';
      }
   }

   // Called when the user updates a tab
   chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
      if (changeInfo.status == 'loading' && (tab.url.indexOf(mailURL) == 0 || tab.url.indexOf(mailURL.replace("http:", "https:")) == 0 || tab.url.indexOf(mailURL.replace("https:", "http:")) == 0)) {
         logToConsole("saw gmail! updating...");
         window.setTimeout(getInboxCount, 0);
      }
   });
}